const DISCOVERY_DOCS = ['https://sheets.googleapis.com/$discovery/rest?version=v4']
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets'

const connectButton = document.getElementById('connect_button')
const authorizeButton = document.getElementById('authorize_button')
const signoutButton = document.getElementById('signout_button')

const form = document.getElementById('form')
const authorize = document.getElementById('authorize')
const connected = document.getElementById('connected')

const clientId = document.getElementById('client-id')
const apiKey = document.getElementById('api-key')
const spreadsheetId = document.getElementById('spreadsheet-id')

const previousClientId = localStorage.getItem('clientId')
if (!!previousClientId) {
  clientId.value = previousClientId
}
const previousApiKey = localStorage.getItem('apiKey')
if (!!previousApiKey) {
  apiKey.value = previousApiKey
}
const previousSpreadSheetId = localStorage.getItem('spreadsheetId')
if (!!previousSpreadSheetId) {
  spreadsheetId.value = previousSpreadSheetId
}

let app
let lastResourceVersion

let params
const MAX_ROWS = 100
const CLIENT_ID = clientId.value
const API_KEY = apiKey.value

connectButton.addEventListener('click', (event) => {
  localStorage.setItem('clientId', clientId.value)
  localStorage.setItem('apiKey', apiKey.value)
  localStorage.setItem('spreadsheetId', spreadsheetId.value)
  gapi.load('client:auth2', initClient)
})

function initClient() {
  if (clientId.value.trim() === '' || apiKey.value.trim() === '' || spreadsheetId.value.trim() === '') {
    return
  }
  params = { spreadsheetId: spreadsheetId.value }
  gapi.client
    .init({
      apiKey: apiKey.value.trim(),
      clientId: clientId.value.trim(),
      discoveryDocs: DISCOVERY_DOCS,
      scope: SCOPES,
    })
    .then(
      function () {
        form.style.display = 'none'
        // Listen for sign-in state changes.
        gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus)

        // Handle the initial sign-in state.
        updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get())
        authorizeButton.onclick = () => gapi.auth2.getAuthInstance().signIn()
        signoutButton.onclick = () => gapi.auth2.getAuthInstance().signOut()
      },
      function (error) {
        form.style.display = 'block'
        authorize.style.display = 'none'
        connected.style.display = 'none'
        appendPre(JSON.stringify(error, null, 2))
      },
    )
}

function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorize.style.display = 'none'
    connected.style.display = 'block'
    start()
  } else {
    authorize.style.display = 'block'
    connected.style.display = 'none'
  }
}

function appendPre(message) {
  var pre = document.getElementById('content')
  var textContent = document.createTextNode(message + '\n')
  pre.appendChild(textContent)
}

function start() {
  getAllSheetNames()
    .then((sheets) => (app = App(sheets)))
    .then(() => {
      return fetch('/apis/apps/v1/deployments')
    })
    .then((response) => response.json())
    .then((response) => {
      const deployments = response.items
      lastResourceVersion = response.metadata.resourceVersion
      deployments.forEach((pod) => {
        const deploymentId = `${pod.metadata.namespace}-${pod.metadata.name}`
        app.upsert(deploymentId, pod)
      })
    })
    .then(() => streamUpdates())

  setInterval(() => {
    poll()
  }, 5000)
}

function poll() {
  getAllSheetNames()
    .then((sheets) => {
      return gapi.client.sheets.spreadsheets.values.batchGet({
        ...params,
        ranges: sheets.filter((it) => it !== 'Sheet1').map((it) => `${it}!A2:C${MAX_ROWS}`),
      })
    })
    .then((response) => {
      response.result.valueRanges.forEach(({ range, values }) => {
        const namespace = range.split('!')[0].replace(/'/g, '')
        values.forEach((row) => {
          if (row[0] === '') {
            return
          }
          if (row[1] === '') {
            return
          }
          if (`${row[1]}` !== `${row[2]}`) {
            console.log('SCALE', row[0], ' in ', namespace)
            fetch(`/apis/apps/v1/namespaces/${namespace}/deployments/${row[0]}`, {
              method: 'PATCH',
              body: JSON.stringify({ spec: { replicas: parseInt(row[1], 10) } }),
              headers: {
                'Content-Type': 'application/strategic-merge-patch+json',
              },
            })
          }
        })
      })
    })
}

function streamUpdates() {
  fetch(`/apis/apps/v1/deployments?watch=1&resourceVersion=${lastResourceVersion}`)
    .then((response) => {
      const stream = response.body.getReader()
      const utf8Decoder = new TextDecoder('utf-8')
      let buffer = ''

      return stream.read().then(function processText({ done, value }) {
        if (done) {
          console.log('Request terminated')
          return
        }
        buffer += utf8Decoder.decode(value)
        buffer = findLine(buffer, (line) => {
          if (line.trim().length === 0) {
            return
          }
          try {
            const event = JSON.parse(line)
            console.log('PROCESSING EVENT: ', event)
            const deployment = event.object
            const deploymentId = `${deployment.metadata.namespace}-${deployment.metadata.name}`
            switch (event.type) {
              case 'ADDED': {
                app.upsert(deploymentId, deployment)
                break
              }
              case 'DELETED': {
                app.remove(deploymentId)
                break
              }
              case 'MODIFIED': {
                app.upsert(deploymentId, deployment)
                break
              }
              default:
                break
            }
            lastResourceVersion = deployment.metadata.resourceVersion
          } catch (error) {
            console.log('Error while parsing', line, '\n', error)
          }
        })
        return stream.read().then(processText)
      })
    })
    .catch(() => {
      console.log('Error! Retrying in 5 seconds...')
      setTimeout(() => streamUpdates(), 5000)
    })

  function findLine(buffer, fn) {
    const newLineIndex = buffer.indexOf('\n')
    if (newLineIndex === -1) {
      return buffer
    }
    const chunk = buffer.slice(0, buffer.indexOf('\n'))
    const newBuffer = buffer.slice(buffer.indexOf('\n') + 1)
    fn(chunk)
    return findLine(newBuffer, fn)
  }
}

function renderSheet(rows, sheetName) {
  return gapi.client.sheets.spreadsheets.values.batchUpdate(params, {
    valueInputOption: 'RAW',
    data: [
      {
        range: `${sheetName}!A1:A${rows.length + 1}`,
        values: [['Deployment'], ...rows.map((it) => [it.name])],
      },
      {
        range: `${sheetName}!B1`,
        values: [['Desired']],
      },
      {
        range: `${sheetName}!C1:C${rows.length + 1}`,
        values: [['Actual'], ...rows.map((it) => [it.replicas])],
      },
      {
        range: `${sheetName}!A${rows.length + 2}:C${MAX_ROWS}`,
        values: [...range(MAX_ROWS - rows.length - 1).map((i) => ['', '', ''])],
      },
    ],
  })
}

function createSheets(titles) {
  if (titles.length === 0) {
    return Promise.resolve()
  }
  return gapi.client.sheets.spreadsheets.batchUpdate(params, {
    requests: titles.map((it) => ({
      addSheet: {
        properties: {
          title: it,
        },
      },
    })),
  })
}

function deleteSheets(sheetNames) {
  if (sheetNames.length === 0) {
    return Promise.resolve()
  }
  return gapi.client.sheets.spreadsheets
    .get(params)
    .then((response) => {
      const mappings = response.result.sheets.reduce((acc, it) => {
        acc[it.properties.title] = it.properties.sheetId
        return acc
      }, {})
      return sheetNames.map((it) => mappings[it]).filter((it) => !!it)
    })
    .then((sheetIds) => {
      return gapi.client.sheets.spreadsheets.batchUpdate(params, {
        requests: sheetIds.map((it) => ({
          deleteSheet: {
            sheetId: it,
          },
        })),
      })
    })
    .catch(() => {})
}

function getAllSheetNames() {
  return gapi.client.sheets.spreadsheets.get(params).then((it) => it.result.sheets.map((it) => it.properties.title))
}

function range(n) {
  return [...Array(n).keys()]
}

function App(sheets = ['Sheet1']) {
  const allDeployments = new Map()

  async function render() {
    const deployments = Array.from(allDeployments.values())
    if (deployments.length !== 0) {
      const deploymentsByNamespace = groupBy(deployments, (it) => it.namespace)
      const namespaces = Object.keys(deploymentsByNamespace)
      const { added, removed } = diff({ previous: sheets, current: ['Sheet1', ...namespaces] })
      added.forEach((it) => sheets.push(it))
      removed.forEach((it) => {
        const index = sheets.findIndex((sheet) => sheet === it)
        sheets.splice(index, 1)
      })
      try {
        await Promise.all([createSheets(added), deleteSheets(removed)])
        await Promise.all(
          namespaces.map((namespace) => {
            return renderSheet(deploymentsByNamespace[namespace], namespace)
          }),
        )
      } catch (error) {
        console.log('ERROR in rendering', error)
      }
    }
    setTimeout(render, 1500)
  }

  render()

  return {
    upsert(deploymentId, deployment) {
      allDeployments.set(deploymentId, {
        name: deployment.metadata.name,
        namespace: deployment.metadata.namespace,
        replicas: deployment.spec.replicas,
      })
    },
    remove(deploymentId) {
      allDeployments.delete(deploymentId)
    },
  }
}

function groupBy(arr, groupByKeyFn) {
  return arr.reduce((acc, c) => {
    const key = groupByKeyFn(c)
    if (!(key in acc)) {
      acc[key] = []
    }
    acc[key].push(c)
    return acc
  }, {})
}

function diff({ previous, current }) {
  const uniqueCurrentIds = current.filter(onlyUnique)
  const uniquePreviousIds = previous.filter(onlyUnique)
  return {
    removed: uniquePreviousIds.filter((a) => uniqueCurrentIds.findIndex((b) => a === b) === -1),
    unchanged: uniquePreviousIds.filter((a) => uniqueCurrentIds.findIndex((b) => a === b) > -1),
    added: uniqueCurrentIds.filter((b) => uniquePreviousIds.findIndex((a) => a === b) === -1),
  }
}

function onlyUnique(value, index, self) {
  return self.map((it) => `${it}`).indexOf(`${value}`) === index
}

function debounce(func, wait, immediate) {
  var timeout
  return function () {
    var context = this,
      args = arguments
    var later = function () {
      timeout = null
      if (!immediate) func.apply(context, args)
    }
    var callNow = immediate && !timeout
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
    if (callNow) func.apply(context, args)
  }
}

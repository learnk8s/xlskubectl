# xlskubectl — a spreadsheet to control your Kubernetes cluster

xlskubectl integrates Google Spreadsheet with Kubernetes.

You can finally administer your cluster from the same spreadsheet that you use to track your expenses.

![xlskubectl — a spreadsheet to control your Kubernetes cluster](preview.gif)

## Usage

You can start the bridge with:

```bash
$ kubectl proxy --www=.
Starting to serve on 127.0.0.1:8001
```

Open the following URL <http://127.0.0.1:8001/static>.

The page will guide through creating the appropriate credentials to connect to Google Spreadsheet.

## Frequently Asked Questions

**Q: What?!**

A: The following quote best summarises this project:

> They were so preoccupied with whether or not they could, they didn't stop to think if they should.

**Q: Not but really, what's going on here?!**

A: Kubernetes exposes a robust API that is capable of streaming incremental updates. Google Spreadsheet can be scripted to read and write values, so the next logical step is to connect the two (also, [credit to this person](https://www.reddit.com/r/kubernetes/comments/ftgo69/sheet_ops_managing_kubernetes_using_google/)).

**Q: Is this production-ready?**

A: We're looking for fundings to take this to the next level. Replacing YAML with spreadsheets has always been our mission as a company, and we will continue to do so.
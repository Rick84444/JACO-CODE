---
name: Create GitHub repository
description: Create a repository on the operator's GitHub account through the API, with the name the operator gives.
tasks: [github-create-repo]
---

# Create GitHub repository

Create exactly one repository as the operator's input describes.

## Procedure

1. Take the repository name character for character from the input. If the input has no clear name,
   output `{"blocked":true,"reason":"no repository name in the input"}`; never invent one.
2. Private unless the input says public. Use a description only if the input gives one.
3. Run `github-create-repo {name, description?, private?}` once. If the receipt says the repository
   already exists, that is the result; do not retry with another name.
4. Complete with a reason that gives the repository URL from the receipt.

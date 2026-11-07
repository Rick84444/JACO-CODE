---
name: Build a web page
description: Make a finished, good-looking web page from a plain description (a business, an event, a portfolio, a landing page), as one file that opens in any browser.
tasks: [repo-list, repo-read, repo-write, repo-edit, browser-survey-site, web-fetch, git-status, git-commit]
---

# Build a web page

The person asking is often a beginner. They describe what they want in everyday words ("a page for my bakery
with opening hours and a menu"). Give them a finished page they can open, show and share, not a tutorial.

## Before you write

1. Work out from the request: who the page is for, what it must say, and what the visitor should do (call,
   book, buy, read). If the request says almost nothing, make sensible choices yourself and say which in the
   answer; ask only when a fact you would otherwise invent matters (a phone number, an address, a price).
2. Never invent facts about a real business. Where a real fact is missing, write a clearly marked placeholder
   such as `[Ditt telefonnummer]` and list every placeholder in the answer.

## The page

- One file, `site/index.html`, with all CSS inside and no external scripts, fonts or images, so it works
  offline and can be put on any web host as it is.
- Write it in the language of the request. Use the person's own words where they gave them.
- Structure: a clear headline that says what it is, a short introduction, the sections the request needs
  (for example services, menu, opening hours, prices, about, contact), and one obvious call to action.
- Design: a calm colour scheme with enough contrast, generous spacing, readable type (system fonts), and a
  layout that works on a phone (one column under about 640 px). Use simple CSS shapes instead of image
  files, never emoji; never link images from other sites.
- Accessible: real headings in order, `lang` on `<html>`, alt text for any image, links that say where they go.
- Contact details as working links (`tel:`, `mailto:`) when they are given.

## Check your work

1. Open the file in the browser (`browser-survey-site` with its `file://` address, or serve the folder if the
   browser refuses `file://`) and read it back: the headline, every section and the call to action are there.
2. Fix what is missing with `repo-edit`; do not rewrite a finished file.
3. Commit with a short message, for example `site: page for <name>`.

## The answer

In plain words, without code: what the page contains, where the file is, every placeholder the person must
fill in, and how to publish it (for example: drag the `site` folder to Netlify Drop, or upload `index.html` to
their web host). Offer one or two concrete next improvements.

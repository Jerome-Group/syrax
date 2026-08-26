# The button carries the number and the message carries the name

[ADR-0026](0026-the-shortlist-is-the-units-and-the-file-is-handed-over.md) put a document's name on
its button and [ADR-0028](0028-a-close-call-offers-ten.md) raised the count to ten. Neither asked how
wide a button is. It is about **twelve characters**, and this corpus does not have twelve characters
to spare. [#192](https://github.com/Jerome-Group/syrax/issues/192).

## The shortlist was offering ten labels that do not say what they are

A close call for `mh1300 midterm 2025`, on the phone, in the three-column grid the client chooses:

```
01 NTU, AY…    MH1300_M…      _NTULearn…
20 Curatio…    _NTULearn…     00 Module…
00 Module…     MH1300_M…      20 Curatio…
MH1101_Course_I…              None of these
```

**Two different buttons read `MH1300_M…`.** They are the 2023 and the 2024 paper. `_NTULearn…`
appears twice, `20 Curatio…` twice, `00 Module…` twice. The Owner tapped three wrong years before
giving up, and there was nothing on the screen that would have let them do otherwise.

Truncation is not an accident of these particular names — it is structural here. Every name in this
corpus is front-loaded with the part that is *shared* across the candidates: a module code, a
document kind, an institution and an academic year. `MH1300_Midterm_` is fifteen characters before
the year that distinguishes one paper from another. The longer and more precise the filename, the
more reliably the client cuts away the only part that matters.

The message body has no such limit. It wraps, and it was carrying one line of nothing:
*"Please select the document you are looking for:"*.

## So the name goes where there is room for it

The reply is now a numbered list in the message, and the buttons are the numbers:

```
Please select the document you are looking for:

1. MH1300_Midterm_2025_Questions.pdf
2. MH1300_Midterm_2025_Solutions.pdf
3. MH1300_Midterm_2024_Questions.pdf
```

A one- or two-character label cannot truncate, which is the whole of the fix.

**Nothing about the tap changes.** The button's `value` is still the opaque `choice` the unit
minted, the unit is still the only thing that can turn one back into a document, and the model still
never works out what was tapped. ADR-0026 is untouched in every part except which string is printed
on the button.

## The number is the unit's, for the reason the tap value is

`Verdict.as_reply` now mints a 1-based `position` beside each `choice`, and the instruction says to
number every line from it and never by counting.

A model counting its own list is a plausible-looking alternative and a bad one: write `3.` beside
the fourth name and a tap on `3` fetches a document whose name the Owner never read — which is this
very failure, arriving through its own fix, and arriving silently. The unit already knows the
position; the digit that appears twice in the reply is worth less than the class of bug it removes.

`position` and `choice` are present together or not at all. A verdict with nothing to choose between
has no list to number, and a resolved tap answers with one document rather than a line of a list.

## Consequences

- **ADR-0028's ten is unchanged, and what it reads like is not.** Ten *buttons* was a page of results
  to scan; ten buttons reading `1` through `10` is a keypad under a page of results. The scanning
  moved from the keyboard to the message, which is where it can be done.
- **A shortlist message is now ten lines rather than one.** That is the cost, it is paid in a
  message rather than in a turn's context, and it is what the Owner asked for.
- **The three-renderings problem ADR-0028 names gets easier to see rather than harder.** Three copies
  of one chapter filling three slots were three identical truncations; now they are three full paths
  the Owner can tell apart.

## Revisit when

- **The Owner starts typing the number instead of tapping it.** That is the design considered and
  not taken here: it needs `choose` to accept a position, which reopens ADR-0026's contract and
  introduces a race a tap does not have — a typed `3` after a second search is ambiguous in a way a
  `callback_data` payload never is. If tapping stops happening, that trade is worth re-pricing.
- **A client stops truncating, or the grid stops being three columns.** The twelve characters are
  the client's, measured on one phone, and nothing here is fitted to the exact number.

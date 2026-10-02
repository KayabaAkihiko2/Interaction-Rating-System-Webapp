# IRS scoring rules

Manual referenced in the supplied rules: **かかわり指標マニュアル**.

## Contents

- [1. Cross-item / dependency rules](#1-cross-item--dependency-rules)
- [2. All explicit automatic YES/NO rules](#2-all-explicit-automatic-yesno-rules)
  - [Items 1–3](#items-13)
  - [Section 5 — Emotional regulation](#section-5--emotional-regulation)
  - [Section 6 — Support for autonomy development](#section-6--support-for-autonomy-development)
  - [Section 7 — Support for responsiveness](#section-7--support-for-responsiveness)
  - [Section 8 — Support for empathy](#section-8--support-for-empathy)
  - [Section 9 — Support for cognitive development](#section-9--support-for-cognitive-development)
  - [Section 10 — Support for socioemotional development](#section-10--support-for-socioemotional-development)

## 1. Cross-item / dependency rules

| Trigger | Forced result | Strength |
| --- | --- | --- |
| Caregiver never attempts to soothe the child | 5.2 = NO | Strict |
| Caregiver never attempts to soothe the child | 5.3 = NO + 7.2 = NO + 7.4 = NO + 7.5 = NO + 7.6 = NO + 8.5 = NO | Strict explicit dependency |
| 8.4: caregiver only claps to praise, with no physical contact | 8.4 = NO, but 8.1 = YES | Strict explicit cross-item rule |
| Any of 6.6, 7.4, or 7.5 = NO | 9.7 is often NO | Not absolute; manual says 「×になることが多い」 = "often becomes NO" |
| Scoring 5.1, 5.2, 5.3 | Scores must be considered together for consistency: 5.1 = recovery with observation only; 5.2 = recovery with verbal prompting but without soothing; 5.3 = recovery after soothing | Consistency rule, not a simple Boolean dependency |

The explicit soothing cascade is stated directly in the manual. The 8.4→8.1 exception is also explicit. The 9.7 relationship is deliberately weaker: the manual says it is often, rather than necessarily, NO if 6.6, 7.4, or 7.5 is NO.

## 2. All explicit automatic YES/NO rules

These are the fixed exceptions/overrides in the manual that you would want to encode in a scoring system.

### Items 1–3

| Item | Condition | Score |
| --- | --- | --- |
| 1.2 | Child smiles/grins without it being directed at anyone and without contextual meaning | NO |
| 2.3 | Caregiver never attempts eye contact | NO |
| 2.4 | Caregiver does not speak to child | NO |
| 2.5 | In the usual case, caregiver uses gestures/emotional expression and child vocalizes in response | normally YES |
| 3.3 | Caregiver does not speak to child | NO |
| 3.4 | Smile is undirected/contextless | NO |
| 3.4 | Caregiver does not speak to child | NO |

The undirected/contextless smile rule is explicit for 1.2 and 3.4. Lack of caregiver eye-contact initiation or speech produces the stated NO scores in 2.3/2.4 and 3.3/3.4.

### Section 5 — Emotional regulation

| Item | Condition | Score |
| --- | --- | --- |
| 5.1 | Child cannot regulate emotion, e.g. remains completely expressionless/unresponsive | NO |
| 5.1 | No situation requiring emotional regulation occurs during observation | YES |
| 5.2 | Child remains unsettled/unresponsive despite calling etc. | NO |
| 5.2 | No situation requiring emotional regulation occurs | YES |
| 5.2 | Caregiver never attempts soothing | NO |
| 5.3 | Child remains unsettled/unresponsive / emotional control is ineffective | NO |
| 5.3 | No situation requiring emotional regulation occurs | YES |
| 5.3 | Caregiver never attempts soothing | NO, plus the dependency cascade above |
| 5.4 | Child has no situation requiring emotional regulation | YES |
| 5.4 | Child does not need help or comfort | YES |
| 5.4 | Child is completely expressionless / cannot regulate emotion | NO |

The manual explicitly tells the rater to judge 5.1–5.3 as a hierarchy across the whole task rather than as unrelated observations.

### Section 6 — Support for autonomy development

| Item | Condition | Score |
| --- | --- | --- |
| 6.1 | Caregiver tries to allow exploration, but child shows no interest | YES |
| 6.1 | Caregiver keeps holding the object until the first task begins | NO |
| 6.3 | Child is satisfied, but caregiver nevertheless makes child repeat task 4+ times | NO |
| 6.3 | Child never succeeds | YES |
| 6.3 | Child voluntarily wants to repeat it 4+ times | YES |
| 6.4 | Caregiver arranges for child to complete the final action independently | YES |
| 6.4 | Caregiver merely guides rather than completing task for child | YES |
| 6.5 | Child never becomes irritated | YES |
| 6.6 | Even once, caregiver continues giving instructions without allowing the child an opportunity to respond | NO |
| 6.7 | Child remains concentrated and never engages in irrelevant manipulation of the object | YES |
| 6.8 | Caregiver says discouraging things such as "completely wrong" | NO |
| 6.8 | Caregiver predicts failure before instruction, e.g. "Maybe you can't do it" | NO |
| 6.9 | Caregiver controls the child and does not allow the child to attempt the whole task | NO |

The special 6.1 and 6.3 cases are stated explicitly. The remaining Section 6 overrides are given on the next page.

### Section 7 — Support for responsiveness

| Item | Condition | Score |
| --- | --- | --- |
| 7.4 | Child is initially not paying attention and caregiver begins instruction without noticing/redirecting attention | NO |
| 7.4 | Child is already paying attention from the beginning | YES |
| 7.6 | Child is sitting on caregiver's lap but eye contact remains possible | YES |
| 7.7 | Child successfully performs the task, so repositioning is unnecessary | YES |
| 7.8 | Child has back toward caregiver, but caregiver maintains a posture that keeps child in visual field | YES |

These exceptions are specified rather than treated as missing opportunities.

### Section 8 — Support for empathy

| Item | Condition | Score |
| --- | --- | --- |
| 8.2 | Caregiver speaks in a gentle tone | YES |
| 8.2 | Caregiver uses a negative tone such as "There you go again!" | NO |
| 8.3 | Child never smiles/vocalizes, so no response opportunity occurs | NO |
| 8.3 | Undirected/contextless grinning is excluded from the relevant smile events | Exclude event |
| 8.4 | Touch is intended merely to attract attention | NO |
| 8.4 | Caregiver claps to praise but does not physically touch child | NO |
| 8.1 in that same clapping case | Clapping counts as praise | YES |
| 8.5 | Child never becomes irritated | YES |
| 8.6 | Child starts speaking while caregiver speaks, and caregiver does not immediately stop | NO |
| 8.6 | Child never speaks/vocalizes during observation | NO |
| 8.7 | Child has not improved/succeeded but caregiver praises the child's ongoing effort/process | YES |
| 8.7 | Caregiver simply says praise words without matching them to child's behaviour/state | NO |
| 8.8 | Child has not improved but caregiver nonverbally acknowledges/praises the process | YES |
| 8.9 | Child never speaks/vocalizes | NO |

These rules occupy much of the explicit exception language in Section 8.

**Derived coding shortcut**

```text
Child never vocalizes at all → 8.6 = NO and 8.9 = NO.
If the child also never smiles, 8.3 = NO.
```

### Section 9 — Support for cognitive development

| Item | Condition | Score |
| --- | --- | --- |
| 9.1 | Caregiver attends to task and child is concentrated ≥60% | YES |
| 9.3 | Child completes task after the first explanation | YES |
| 9.3 | Child does not succeed after first explanation and caregiver simply repeats exactly the same phrase | NO |
| 9.3 | There is even a small change in the explanatory phrase | YES |
| 9.5 | Caregiver uses only vague demonstratives, e.g. "put this there" | NO |
| 9.5 | Caregiver gives no instruction | NO |
| 9.7 | 6.6 or 7.4 or 7.5 is NO | Often NO, not mandatory |
| 9.8 | At completion caregiver only looks at the observer for guidance/reaction rather than signaling completion to child | NO |

The 9.3/9.5 rules and the 9.7 dependency are explicit in the manual.

### Section 10 — Support for socioemotional development

| Item | Condition | Score |
| --- | --- | --- |
| 10.1 | Caregiver uses negative wording/tone such as calling child "bad" | NO |
| 10.3 | Handling of objects or manner of teaching is rough | NO |
| 10.4 | Caregiver hits child, even jokingly or accompanied by positive language | NO |
| 10.5 | Caregiver says negative things about child to observer | NO |
| 10.6 | Caregiver begins tense but is relaxed for ≥50% of task | YES |

"""PROTOTYPE — wipe me. Ticket #34: what floor and gap make `confident` safe?

ADR-0004 makes `confident` require three things at once: the top result clears an
absolute score floor, the gap to #2 exceeds a margin, and both arms independently
rank it first. It left the two numbers to this trial.

`confident` sends a file without asking, so a wrong `confident` costs trust. The
operating point is chosen for PRECISION first: no wrong answer may be confident.
Coverage is whatever is left.
"""

import itertools
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FLOORS = [round(x * 0.02, 2) for x in range(0, 30)]
GAPS = [0.0, 0.0002, 0.0005, 0.001, 0.002, 0.004, 0.008, 0.015]


def rows(model):
    d = json.load(open(os.path.join(HERE, f"eval_{model}.json")))
    out = []
    for r in d["results"]:
        out.append({
            "id": r["id"],
            "correct": r["rank"] == 1,
            "empty_expected": r["expect_empty"],
            "cos": r["cos_top"],
            "gap": r["rrf_gap_doc"],
            "agree": r["both_arms_agree"],
        })
    return d, out


def score(rs, floor, gap, need_agree):
    """Return (confident_right, confident_wrong, covered)."""
    right = wrong = 0
    for r in rs:
        conf = r["cos"] >= floor and r["gap"] >= gap and (r["agree"] or not need_agree)
        if not conf:
            continue
        if r["empty_expected"] or not r["correct"]:
            wrong += 1
        else:
            right += 1
    return right, wrong


def main(models):
    for m in models:
        d, rs = rows(m)
        answerable = [r for r in rs if not r["empty_expected"]]
        print(f"\n=== {m} — {sum(r['correct'] for r in answerable)}/{len(answerable)} correct at rank 1 ===")

        for need_agree in (True, False):
            best = None
            for floor, gap in itertools.product(FLOORS, GAPS):
                right, wrong = score(rs, floor, gap, need_agree)
                if wrong == 0 and (best is None or right > best[0]):
                    best = (right, floor, gap)
            label = "ADR-0004 as written (both arms must agree)" if need_agree else "without the agreement condition"
            if best and best[0] > 0:
                right, floor, gap = best
                print(f"  {label}:")
                print(f"    floor {floor}  gap {gap}  -> {right} confident, 0 wrong "
                      f"({right}/{len(answerable)} of answerable queries)")
            else:
                print(f"  {label}: no operating point marks ANY query confident without also marking a wrong one")

        # The floor has a SECOND job ADR-0004 gives it: `empty` fires when nothing
        # clears it. That needs the floor to sit above an unanswerable query and
        # below every correct one - a different demand from separating right from wrong.
        correct_cos = [r["cos"] for r in rs if r["correct"]]
        empty_cos = [r["cos"] for r in rs if r["empty_expected"]]
        wrong_cos = [r["cos"] for r in rs if not r["correct"] and not r["empty_expected"]]
        if correct_cos and empty_cos:
            lo, hi = max(empty_cos), min(correct_cos)
            if lo < hi:
                print(f"  `empty` floor: any value in ({lo:.3f}, {hi:.3f}) "
                      f"-> midpoint {round((lo + hi) / 2, 2)}")
            else:
                print(f"  `empty` floor: NONE EXISTS - the unanswerable query scores {lo:.3f}, "
                      f"above the weakest correct answer at {hi:.3f}")
        print(f"  cos ranges: correct [{min(correct_cos):.3f}, {max(correct_cos):.3f}]  "
              f"wrong [{min(wrong_cos):.3f}, {max(wrong_cos):.3f}]  "
              f"-> {'OVERLAP, no separating floor' if min(wrong_cos) < max(correct_cos) else 'separable'}")

        print("  per-query signals:")
        for r in rs:
            flag = "RIGHT" if r["correct"] else ("EMPTY-EXPECTED" if r["empty_expected"] else "wrong")
            print(f"    {r['id']:<4} {flag:<15} cos={r['cos']:>7.3f} gap={r['gap']:>8.5f} agree={str(r['agree']):<5}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["potion", "bge"])

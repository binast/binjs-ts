
import * as assert from 'assert';

import * as S from './schema';
import {fieldTypeForValue} from './util';
import {DfsIter, IterResult, IterKind} from './tree_iterator';

/**
 * A tree template captures the prefix of a subtree
 * that matches a subset of trees.
 *
 * A tree template can be specified with a series of
 * cuts to an existing tree, with each cutpoint being
 * interpreted as a bread-first index into the existing
 * tree.
 *
 * Given a candidate tree, a cutpoint set can be
 * computed against it which matches an arbitrary set
 * of continuing trees.  In the worst case this is
 * the trivial cut at the top of the tree (0).
 */

export function buildPrefixCuts(candidates: Array<S.BaseNode>): Array<number> {
    const iterators: Array<DfsIter> = candidates.map(c => new DfsIter(c));
    const cuts: Array<number> = [];
    console.log(`START(${iterators.length})`);

    // There are no cuts for an empty list of trees or for
    // a single tree.
    if (iterators.length <= 1) {
        return [];
    }

    // Walk each iterator once a step.
    for (;;) {
        const results: Array<IterResult> = [];
        console.log(`CALLING next()`);
        iterators.forEach((iter: DfsIter) => {
            results.push(iter.next());
        });

        // Assert that all iterator results have the same type.
        assert(results.every(r => (r.kind === results[0].kind)));
        assert(results.every(r => (r.stepNo >= 0 &&
                                   (r.stepNo === results[0].stepNo))),
               `STEP MISMATCH: ${results.map(r => r.stepNo).join(',')}`);

        const r0 = results[0];

        // If it's a Child (node), check the types.
        if (r0.isChild()) {
            const typesSame = results.every(r => {
                assert(r.name === r0.name, "Child names dont match.");
                assert(r.stepNo === r0.stepNo);
                return (r.getChild() !== null) &&
                       (r.getChild().nodeKindName ===
                        r0.getChild().nodeKindName);
            });
            if (typesSame) {
                console.log(`STEP child .${r0.name} = ${r0.getChild().nodeKindName}`);
                // step into the child.
                iterators.forEach(i => i.step());
            } else {
                // Cut child.
                console.log(`CUT child ${r0.name}`);
                cuts.push(r0.stepNo);
                iterators.forEach(i => i.cut());
            }
        } else if (r0.isFieldType()) {
            // Check the field type across all the values.
            const typesSame = results.every(r => {
                assert(r.name === r0.name, "Field names don't match");
                assert(r.stepNo === r0.stepNo);
                return r.getFieldType() === r0.getFieldType();
            });
            if (typesSame) {
                // step into the field value.
                console.log(`STEP field_type .${r0.name} = ${r0.getFieldType()}`);
                iterators.forEach(i => i.step());
            } else {
                // Cut the field value.
                console.log(`CUT field_type ${r0.name}`);
                cuts.push(r0.stepNo);
                iterators.forEach(i => i.cut());
            }
        } else if(r0.isFieldValue()) {
            // Check the field type across all the values.
            const valuesSame = results.every(r => {
                assert(r.name === r0.name, `Field value names don't match: ${r.name} vs ${r0.name}`);
                assert(r.stepNo === r0.stepNo);
                return r.getFieldValue() === r0.getFieldValue();
            });
            if (valuesSame) {
                // step into the field value.
                console.log(`STEP field_value ${r0.name}`);
                iterators.forEach(i => i.step());
            } else {
                // Cut the field value.
                console.log(`CUT field_value ${r0.name}`);
                cuts.push(r0.stepNo);
                iterators.forEach(i => i.cut());
            }
        } else {
            assert(r0.isDone());
            console.log("DONE()");
            break;
        }
    }

    return cuts;
}

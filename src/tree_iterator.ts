
import * as assert from 'assert';
import * as S from './schema';
import {fieldTypeForValue} from './util';

/**
 * This implements a simple iterator over AST trees.
 */

export enum IterKind {
    FieldType = "FieldType",
    FieldValue = "FieldValue",
    Child = "Child",
    Done = "Done"
};

export class IterResult {
    kind: IterKind;
    name: string|null;
    value: any;
    stepNo: number;

    constructor(params: {kind: IterKind, name: string, value: any}) {
        this.kind = params.kind;
        this.name = params.name;
        this.value = params.value;
        this.stepNo = -1;
    }

    static newChild(name: string, node: S.BaseNode|null): IterResult {
        return new IterResult({kind: IterKind.Child, name, value: node});
    }
    static newFieldType(name: string, value: any): IterResult {
        return new IterResult({kind: IterKind.FieldType, name, value});
    }
    static newFieldValue(name: string, value: any): IterResult {
        return new IterResult({kind: IterKind.FieldValue, name, value});
    }
    static newDone(stepNo: number): IterResult {
        const result = new IterResult({kind: IterKind.Done,
                                       name: null, value: null});
        result.stepNo = stepNo;
        return result;
    }

    isChild(): boolean {
        return this.kind === IterKind.Child;
    }
    getChild(): S.BaseNode|null {
        assert(this.isChild());
        return this.value as (S.BaseNode|null);
    }

    isFieldType(): boolean {
        return this.kind === IterKind.FieldType;
    }
    isFieldValue(): boolean {
        return this.kind === IterKind.FieldValue;
    }
    getFieldType(): S.FieldType {
        assert(this.isFieldType());
        return fieldTypeForValue(this.value);
    }
    getFieldValue(): boolean {
        assert(this.isFieldType() || this.isFieldValue());
        return this.value;
    }

    isDone(): boolean {
        return this.kind === IterKind.Done;
    }
}

export class DfsIter {
    readonly root: S.BaseNode;
    curNode: S.BaseNode;
    curQueue: Array<IterResult>;
    curEntry: IterResult|null;

    curStep: number;

    constructor(root: S.BaseNode) {
        this.root = root;
        this.curNode = root;
        this.curQueue = [];
        this.curEntry = null;
        this.curStep = 0;
        this.curQueue.push(IterResult.newChild('', this.curNode));
    }

    // Protocol: call next(), then one of step() or cut() before
    // calling next() again.  Next pulls the next iteration item.
    // Step or Cut indicate whether to traverse the subtree under
    // the iteration element or not.
    //
    // Array children are implicitly skipped when 'stepped'.
    //
    // For field elements, this is a no-op.
    next(): IterResult {
        // console.log(`KVKV NEXT len=${this.curQueue.length}`);
        assert(this.curEntry == null);

        // If the current queue is ever empty, we are done.
        if (this.curQueue.length == 0) {
            return IterResult.newDone(this.curStep);
        }

        // Get the next entry and set it as the current one.
        this.curEntry = this.curQueue.shift();
        this.curEntry.stepNo = this.curStep++;
        // console.log(`KVKV NEXT => ${this.curEntry.kind as string} len=${this.curQueue.length}`);
        return this.curEntry;
    }

    step() {
        const self = this;
        assert(self.curEntry !== null);
        // console.log(`KVKV STEP len=${self.curQueue.length}`);
        if (self.curEntry.isChild()) {
            // Scan the current child entry and add all
            // non-array children to the queue.
            if (self.curEntry.getChild() !== null) {
                const node: S.BaseNode = self.curEntry.getChild();
                node.constructor['scan']({
                    child(name: string, opts?: {skippable?: boolean}) {
                        let child = node[name] as (S.BaseNode|null);
                        assert(child === null || child instanceof S.BaseNode);
                        // console.log(`KVKV CHILD ${node.nodeKindName}.${name} => ${child ? child.nodeKindName : "NULL"}: ${self.curQueue.length}`);
                        self.curQueue.push(IterResult.newChild(name, child));
                    },
                    childArray(name: string) {
                        // Child node arrays are implicitly cut.
                    },
                    field(name: string) {
                        // Fields have no further children to add.
                        let val = node[name];
                        // console.log(`KVKV FIELD TYPE ${node.nodeKindName}.${name} => ${val}: ${self.curQueue.length}`);
                        self.curQueue.push(IterResult.newFieldType(name, val));
                    }
                });
            }
        } else if (self.curEntry.isFieldType()) {
            let name = self.curEntry.name;
            let val = self.curEntry.value;
            // If we step on a FieldType, we process the ensuing
            // value immediately, instead of after in DFS order.
            // console.log(`KVKV FIELD VALUE ${name} => ${val}: ${self.curQueue.length}`);
            self.curQueue.unshift(IterResult.newFieldValue(name, val));
        }
        self.curEntry = null;
    }
    cut() {
        assert(this.curEntry !== null);
        // console.log(`KVKV CUT len=${this.curQueue.length}`);
        this.curEntry = null;
    }
}

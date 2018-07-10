import * as assert from 'assert';

// Compares whether two primitives, objects or arrays are the same or
// have the same properties. Property values are compared with `===`.
function shallowEquals(xs, ys) {
    if (xs === ys) {
        return true;
    }
    if (xs instanceof Array && ys instanceof Array) {
        if (xs.length !== ys.length) {
            return false;
        }
        for (let i = 0; i < xs.length; i++) {
            if (xs[i] !== ys[i]) {
                return false;
            }
        }
        return true;
    }
    // TODO(dpc): Implement shallow object comparison.
    throw Error('shallow object compare not implemented');
}

// Walks an AST and recovers a grammar from it.
export class Grammar {
    // The grammar is just a node kind -> untyped list of properties.
    rules: Map<string, string[]>;
    ruleIndexMap: Map<string, number>;
    indexRuleMap: Map<number, string>;

    constructor(opt_rules?: { [name: string]: string[] }) {
        this.rules = new Map();
        if (opt_rules !== undefined) {
            for (let name of Object.keys(opt_rules)) {
                this.rules.set(name, opt_rules[name]);
            }
        }
        this.ruleIndexMap = null;
        this.indexRuleMap = null;
    }

    nodeType(index: number): string {
        if (this.indexRuleMap == null) {
            let map = new Map<number, string>();
            for (let rule of this.rules.keys()) {
                map.set(map.size, rule);
            }
            this.indexRuleMap = map;
        }
        assert(this.indexRuleMap.has(index),
            `tried to decode unknown node type ${index}`);
        return this.indexRuleMap.get(index);
    }

    index(nodeType: string): number {
        if (this.ruleIndexMap == null) {
            let map = new Map<string, number>();
            for (let rule of this.rules.keys()) {
                // TODO(dpc): When these indices are encoded more carefully
                // the ordering of this map should be tuned to that.
                map.set(rule, map.size);
            }
            this.ruleIndexMap = map;
        }
        assert(this.ruleIndexMap.has(nodeType),
            `tried to encode unknown node type ${nodeType}`);
        return this.ruleIndexMap.get(nodeType);
    }

    /**
     * Visits `node`, checks and records its structure.
     */
    visit(node: any) {
        if (node === null ||
            node === undefined ||
            typeof node === 'number' ||
            typeof node === 'boolean' ||
            typeof node === 'undefined' ||
            typeof node === 'string') {
            // A primitive; do nothing.
        } else if (node instanceof Array) {
            // This is not very JavaScript-y because it doesn't handle
            // array-like objects. But all our arrays are arrays.
            for (let child of node) {
                this.visit(child);
            }
        } else if (node instanceof Object) {
            let kind = node.constructor.name;
            if (!kind) {
                throw Error(`expected a typed AST node, got ${JSON.stringify(node).substring(0, 100)}`);
            }
            if (typeof kind !== 'string') {
                throw Error(`node type tags should be strings, got ${kind}`);
            }
            // TODO(dpc): Consider sorting these. The tree walks rely on
            // properties being visited in the same order; explicit ordering
            // may be less fragile.
            let props = Array.from(Object.keys(node));

            let expected = this.rules.get(kind);
            if (expected && !shallowEquals(props, expected)) {
                throw Error(`encountered differing shapes of ${kind}: ${expected} verus ${props}`);
            } else {
                this.rules.set(kind, props);
            }
            for (let prop of props) {
                this.visit(node[prop]);
            }
        } else {
            throw Error(`expected an AST node; got: ${node}`);
        }
    }
}

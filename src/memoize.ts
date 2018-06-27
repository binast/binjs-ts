// Shallow hash function for AST nodes.
function hash(x: any): number {
    return hash_shallow(x, true);
}

// Helper function for shallow hashing. Will recurse one level if
// `step` is `true`.
function hash_shallow(x: any, step: boolean): any {
    if (Number.isFinite(x)) {
        return Math.round(x);
    }
    if (typeof x === 'boolean' ||
        x === undefined ||
        x === null) {
        return Number(!!x);
    }
    if (typeof x === 'string') {
        let result = 0;
        for (let i = 1; i < x.length; i *= 2) {
            result *= 57;
            result += x.charCodeAt(i);
        }
        return result;
    }
    let result = hash_shallow(x.constructor.name, false);
    if (step) {
        for (let property of Object.keys(x)) {
            result *= 31;
            result += hash_shallow(x[property], false);
        }
    }
    return result;
}

// Shallow equality function for AST nodes. This assumes AST nodes
// have consistent sets of properties.
function equals(x: any, y: any): boolean {
    if (typeof x !== typeof y) {
        return false;
    }
    if (x === y) {
        return true;
    }
    // Same kind of object, and for arrays, same number of elements.
    if (x.constructor !== y.constructor || x.length !== y.length) {
        return false;
    }
    for (let property of Object.keys(x)) {
        if (x[property] !== y[property]) {
            return false;
        }
    }
    return true;
}

export class Memoizer {
    readonly entries: Map<number, any[]>;
    readonly counts: Map<any, number>;

    constructor() {
        this.entries = new Map<number, any[]>();
        this.counts = new Map<any, number>();
    }

    // Note, this modifies 'node'.
    memo(node: any): any {
        if (typeof node === 'number' ||
            typeof node === 'boolean' ||
            typeof node === 'string' ||
            node === null ||
            node === undefined) {
            return node;
        }
        for (let property of Object.keys(node)) {
            node[property] = this.memo(node[property]);
        }
        let h = hash(node);
        let objs = this.entries.get(h);
        if (!objs) {
            objs = [];
            this.entries.set(h, objs);
        }
        for (let obj of objs) {
            if (equals(node, obj)) {
                this.counts.set(obj, this.counts.get(obj) + 1);

                // The counts for all of the child nodes were
                // incremented in rewriting this node, but this node
                // will be shared, so decrement them back.
                for (let property in Object.keys(obj)) {
                    let value = obj[property];
                    if (this.counts.has(value)) {
                        this.counts.set(value, this.counts.get(value) - 1);
                    }
                }

                return obj;
            }
        }
        objs.push(node);
        this.counts.set(node, 1);
        return node;
    }
}

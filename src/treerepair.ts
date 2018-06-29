import * as assert from 'assert';

// A symbol is something which can appear in a tree.
export abstract class Symbol {
    readonly rank: number;

    constructor(rank: number) {
        this.rank = rank;
    }
}

// A terminal is the literal name of a tree node. It can appear in the
// right hand side of productions but not name them. A terminal can
// label a node which has children; "terminal" does not refer to a
// BinAST grammar terminal, which is a leaf node in the AST, but to
// a terminal in the TreeRePair meta-grammar.
export class Terminal extends Symbol {
    constructor(rank: number) {
        super(rank);
    }
}

// A nonterminal is the name of a grammar production. It can label a
// node in a tree when the production is being "invoked."
export class Nonterminal extends Symbol {
    // Do not modify the members of this array.
    readonly formals: Parameter[];

    constructor(rank: number) {
        super(rank);
        this.formals = Array(rank);
        this.formals.forEach((_, i) => {
            this.formals[i] = new Parameter();
        });
    }
}

// A formal parameter of a grammar production.
export class Parameter extends Symbol {
    constructor() {
        super(0);
    }
}

// Nodes can appear in the tree being rewritten, or in the right-hand
// side of productions in the grammar.
export class Node {
    readonly label: Symbol;
    // Tags this node with a string for printing and debugging.
    debug_tag: string;

    // The tree structure.
    parent?: Node;
    firstChild?: Node;
    nextSibling?: Node;
    prevSibling?: Node;

    // The digram structure. The i-th entry in this array is the
    // previous (next) occurrence of the (this.label, i, n-th child
    // label) digram in the tree.
    readonly prevDigram: Node[];
    readonly nextDigram: Node[];

    constructor(label: Symbol) {
        this.label = label;
        this.prevDigram = Array(label.rank);
        this.nextDigram = Array(label.rank);
    }

    debug_find(tag: string): Node | null {
        if (tag === this.debug_tag) {
            return this;
        }
        for (let descendent of post_order(this)) {
            if (this === descendent) {
                return null;
            }
            if (tag === descendent.debug_tag) {
                return descendent;
            }
        }
    }

    // An iterator over the node's children, with their index.
    *child_entries(): IterableIterator<[number, Node]> {
        let i = 0;
        let node = this.firstChild;
        while (node) {
            yield [i++, node];
            node = node.nextSibling;
        }
    }

    nth_child(i: number): Node {
        assert(0 <= i && i < this.label.rank, `${i} out of range, rank=${this.label.rank}`);
        for (let [j, child] of this.child_entries()) {
            if (i === j) {
                return child;
            }
        }
        throw Error('unreachable');
    }
}

// Iterates over the tree yielding parents after children. Post-order
// iterations are useful for iterating over a subtree because the node
// can be used as a sentinel to end the iteration.
export function* post_order(node: Node): IterableIterator<Node> {
    while (node) {
        while (node.firstChild) {
            node = node.firstChild;
        }
        yield node;
        while (node && !node.nextSibling) {
            node = node.parent;
            if (node) {
                yield node;
            }
        }
        if (node) {
            node = node.nextSibling;
        }
    }
}

// Iterates over the tree yielding parents before children.
export function* pre_order(node: Node): IterableIterator<Node> {
    while (node) {
        yield node;
        if (node.firstChild) {
            node = node.firstChild;
        } else {
            while (node && !node.nextSibling) {
                node = node.parent;
            }
            if (node) {
                node = node.nextSibling;
            }
        }
    }
}

// Checks that `node` is a valid tree.
export function check_tree(root: Node) {
    const tortoise = pre_order(root);
    const hare = pre_order(root);

    while (true) {
        let hare_step = hare.next();
        if (hare_step.done) {
            break;
        }
        hare_step = hare.next();
        if (hare_step.done) {
            break;
        }
        let tortoise_step = tortoise.next();
        assert(!tortoise_step.done, 'tortoise outpaced hare');
        if (tortoise_step.value === hare_step.value) {
            throw Error('cycle');
        }
    }

    for (let node of pre_order(root)) {
        if (node.firstChild) {
            if (node.firstChild.prevSibling) {
                throw Error(`"first" child ${node.firstChild.debug_tag} has previous sibling ${node.firstChild.prevSibling.debug_tag}`);
            }
            let i = -1, child;
            for ([i, child] of node.child_entries()) {
                if (child.parent !== node) {
                    throw Error('parent');
                }
            }
            i++;
            if (i !== node.label.rank) {
                throw Error(`rank ${node.label.rank} node ${node.debug_tag} had ${i} children`);
            }
        }
    }
}

// Checks that the doubly linked list of digrams on `node` are in
// order. Unlike `check_tree` this is a local check.
export function check_digram_step(node: Node) {
    assert(node.prevDigram.length === node.label.rank);
    assert(node.nextDigram.length === node.label.rank);

    for (let [i, child] of node.child_entries()) {
        let link = node.nextDigram[i];
        if (!link) {
            continue;
        }
        if (link.label !== node.label) {
            throw Error('mismatched parent');
        }
        if (link.nth_child(i).label !== child.label) {
            throw Error('mismatched child');
        }
        if (link.prevDigram[i] !== node) {
            throw Error('broken back link');
        }
    }
}

import * as assert from 'assert';

// A symbol is something which can appear in a tree.
export abstract class Symbol {
    readonly rank: number;

    constructor(rank: number) {
        this.rank = rank;
    }

    format(labels: Map<Symbol, string>): string {
        return labels.get(this) || '?';
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
        this.formals = [];
        for (let i = 0; i < rank; i++) {
            this.formals.push(new Parameter());
        }
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
    // Note, if this node is the first child, prevSibling points to
    // the parent's last child.
    prevSiblingOrLastChild: Node;

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

    appendChild(child: Node) {
        assert(!child.parent);
        assert(!child.nextSibling);
        assert(!child.prevSiblingOrLastChild);

        child.parent = this;
        if (!this.firstChild) {
            this.firstChild = child;
        } else {
            child.prevSiblingOrLastChild = this.lastChild;
            this.lastChild.nextSibling = child;
        }
        this.firstChild.prevSiblingOrLastChild = child;
        return this;
    }

    get prevSibling(): Node {
        return this.parent && this.parent.firstChild === this ? null : this.prevSiblingOrLastChild;
    }

    get lastChild(): Node {
        return this.firstChild ? this.firstChild.prevSiblingOrLastChild : null;
    }

    // Finds the index of this node in its parent using an O(n) walk.
    get index_slow(): number {
        if (!this.parent) {
            return 0;
        }
        for (let [i, child] of this.parent.child_entries()) {
            if (child === this) {
                return i;
            }
        }
        throw Error('unreachable: node not found in parent\'s child list');
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
            if (node.firstChild.prevSiblingOrLastChild.parent !== node) {
                throw Error(`"first" child ${node.firstChild.debug_tag} has previous sibling/last child pointer to ${node.firstChild.prevSiblingOrLastChild.debug_tag} with different parent`);
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

function check_is_subtree(root: Node, n: Node) {
    while (n !== root && n.parent) {
        n = n.parent;
    }
    if (n === root) {
        return;
    }
    assert(false, 'expected node to be a subtree');
}

// Checks that the digrams table and links are consistent.
export function check_digrams(labels: Map<Symbol, string>, grammar: Grammar) {
    for (let [digram, list] of grammar.digrams.digrams.entries()) {
        assert(digram === list.digram, 'list filed under wrong digram');
        assert(!list.first ||
            list.first.label === digram.parent &&
            list.first.nth_child(digram.index).label === digram.child,
            `${digram.format(labels)} "first" pointing to wrong digram ${list.first ? list.first.label.format(labels) : 'unreachable'} ${digram.index} ${list.first ? list.first.nth_child(digram.index).label.format(labels) : 'unreachable'}`);
        assert(!list.last ||
            list.last.label === digram.parent &&
            list.last.nth_child(digram.index).label === digram.child,
            'digram list "last" pointing to wrong digram');
        assert(list.first ? list.last : !list.last,
            'digram list with a head (tail) must have a tail (head)');
        assert(!list.last || !list.last.nextDigram[digram.index],
            'the last item of the list must not have a "next" item');

        if (list.first) {
            // Check for cycles
            let tortoise = list.first;
            let hare = list.first;
            while (true) {
                hare = hare.nextDigram[digram.index];
                if (hare == null) {
                    break;
                }
                hare = hare.nextDigram[digram.index];
                if (hare == null) {
                    break;
                }
                tortoise = tortoise.nextDigram[digram.index];
                assert(hare !== tortoise, 'cyclic digram list');
                check_is_subtree(grammar.tree, tortoise);
            }

            while (tortoise.nextDigram[digram.index]) {
                // Continue walking to the end of the list.
                tortoise = tortoise.nextDigram[digram.index];
                check_is_subtree(grammar.tree, tortoise);
            }
            assert(tortoise === list.last, 'last not pointing to end of list');
        }
    }

    for (let node of pre_order(grammar.tree)) {
        check_digram_step(node);
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

export class Digram {
    readonly parent: Symbol;
    readonly index: number;
    readonly child: Symbol;

    constructor(parent: Symbol, index: number, child: Symbol) {
        assert(Number.isInteger(index));
        if (index < 0 || parent.rank <= index) {
            throw Error(`index ${index} out of range rank=${parent.rank}`);
        }
        this.parent = parent;
        this.index = index;
        this.child = child;
    }

    format(labels: Map<Symbol, string>): string {
        return `${labels.get(this.parent) || '?'} ${this.index} ${labels.get(this.child) || '?'}`;
    }
}

export class DigramTable {
    readonly parents: Map<Symbol, Map<number, Map<Symbol, Digram>>>;

    constructor() {
        this.parents = new Map();
    }

    get(a: Symbol, i: number, b: Symbol): Digram {
        let parent_step = this.parents.get(a);
        if (!parent_step) {
            parent_step = new Map();
            this.parents.set(a, parent_step);
        }
        let index_step = parent_step.get(i);
        if (!index_step) {
            index_step = new Map();
            parent_step.set(i, index_step);
        }
        let child_step = index_step.get(b);
        if (!child_step) {
            child_step = new Digram(a, i, b);
            index_step.set(b, child_step);
        }
        return child_step;
    }
}

export class DigramList {
    digram: Digram;
    first: Node;
    last: Node;
    occ: Set<Node>;

    constructor(digram: Digram) {
        this.digram = digram;
        this.occ = new Set;
    }

    append(node: Node) {
        if (!this.first) {
            assert(!this.last);
            assert(this.occ.size === 0);
            this.first = this.last = node;
        } else {
            let old_last = this.last;
            old_last.nextDigram[this.digram.index] = node;
            node.prevDigram[this.digram.index] = old_last;
            this.last = node;
        }
        this.occ.add(node);
    }
}

export class Digrams {
    readonly table: DigramTable;
    readonly digrams: Map<Digram, DigramList>;
    readonly max?: number;

    constructor(root: Node, options?: { maxRank: number }) {
        this.table = new DigramTable;
        this.digrams = new Map;
        this.max = options ? options.maxRank : null;

        // See TreeRePair paper Fig. 8.
        for (let parent of post_order(root)) {
            for (let [i, child] of parent.child_entries()) {
                this.add(parent, i, child);
            }
        }
    }

    count(d: Digram): number {
        return this.digram_list(d).occ.size;
    }

    // The "best" digram is the most frequent one.
    best(): Digram {
        let best = null;
        // TODO(dpc): This should be replaced with a min-heap or something.
        for (let list of this.digrams.values()) {
            if (!best || best.occ.size < list.occ.size && list.occ.size > 1) {
                best = list;
            }
        }
        return best ? best.digram : null;
    }

    digram_list(d: Digram) {
        let list = this.digrams.get(d);
        if (!list) {
            list = new DigramList(d);
            this.digrams.set(d, list);
        }
        return list;
    }

    add(parent: Node, i: number, child: Node) {
        // TODO(dpc): The TreeRePair paper does not filter maximum
        // rank in Fig. 29. but it does in Fig. 8. Investigate
        // whether this is relevant to output size.
        const pattern_rank = parent.label.rank + child.label.rank - 1;
        if (this.max !== null && pattern_rank > this.max) {
            // This pattern is too large to rewrite.

            // TODO(dpc): If TreeRePair also rewrote the rules
            // it generated heuristics like maxrank may be
            // unnecessary.
            return;
        }
        let digram = this.table.get(parent.label, i, child.label);
        let list = this.digram_list(digram);
        if (!list.occ.has(child)) {
            list.append(parent);
        }
    }

    remove(parent: Node, i: number, child: Node) {
        let d = this.table.get(parent.label, i, child.label);

        let list = this.digram_list(d);
        list.occ.delete(parent);
        if (list.first === parent) {
            list.first = parent.nextDigram[i];
        }
        if (list.last === parent) {
            list.last = parent.prevDigram[i];
        }

        if (parent.prevDigram[i]) {
            parent.prevDigram[i].nextDigram[i] = parent.nextDigram[i];
        }
        if (parent.nextDigram[i]) {
            parent.nextDigram[i].prevDigram[i] = parent.prevDigram[i];
        }
    }
}

// TODO: appendChild should be O(1)

export class Grammar {
    rules: Map<Nonterminal, Node>;
    tree: Node;
    digrams: Digrams;

    constructor(root: Node, options?: { maxRank: number }) {
        this.tree = root;
        this.rules = new Map;
        this.digrams = new Digrams(root, options);
    }

    // Rewrites the grammar to replace the most frequent digram.
    // Returns the label of the new rule.
    replaceBestDigram(): Nonterminal {
        const digram = this.digrams.best();
        if (!digram) {
            return null;
        }
        return this.replaceDigram(digram);
    }

    private ruleBodyForPattern(new_symbol: Nonterminal, digram: Digram): Node {
        let rule_tree = new Node(digram.parent);
        for (let i = 0; i < digram.index; i++) {
            rule_tree.appendChild(new Node(new_symbol.formals[i]));
        }
        let child = new Node(digram.child);
        rule_tree.appendChild(child);
        for (let i = 0; i < digram.child.rank; i++) {
            child.appendChild(new Node(new_symbol.formals[digram.index + i]));
        }
        for (let i = digram.index + 1; i < digram.parent.rank; i++) {
            const parameter_index = digram.child.rank + i - 1;
            const formal = new_symbol.formals[parameter_index];
            rule_tree.appendChild(new Node(formal));
        }
        return rule_tree;
    }

    // Rewrites one instance of a digram. This is a destructive
    // operation because it adopts the children of the rewritten node,
    // and inserts the new node in place of the old one.
    private rewrite(parent: Node, digram: Digram, new_symbol: Nonterminal): Node {
        let was_first_child = parent.parent && parent.parent.firstChild === parent;
        let was_last_child = parent.parent && parent.parent.lastChild === parent;

        if (parent.parent) {
            // Remove this node from the digram graph; it is going away.
            this.digrams.remove(parent.parent, parent.index_slow, parent);
        }

        // Build an "invocation" node which adopts this node's children.
        let invocation = new Node(new_symbol);

        let adopt_child = (old_parent, i, child, prev) => {
            if (prev === null) {
                invocation.firstChild = child;
            }
            child.parent = invocation;
            child.prevSiblingOrLastChild = prev;
            if (prev) {
                prev.nextSibling = child;
            }

            // Remove the node from the digrams lists.
            this.digrams.remove(old_parent, i, child);

            return child;
        };

        let prev = null;
        for (let [i, child] of parent.child_entries()) {
            if (i === digram.index) {
                // This child is erased.
                this.digrams.remove(parent, i, child);
                // Lift its children.
                for (let [j, grandchild] of child.child_entries()) {
                    prev = adopt_child(child, j, grandchild, prev);
                }
            } else {
                prev = adopt_child(parent, i, child, prev);
            }
        }

        if (invocation.firstChild) {
            invocation.firstChild.prevSiblingOrLastChild = prev;
        }

        // Now replace this node with the beta-abstracted one.

        invocation.parent = parent.parent;
        invocation.nextSibling = parent.nextSibling;
        if (invocation.nextSibling) {
            invocation.nextSibling.prevSiblingOrLastChild = invocation;
        }
        invocation.prevSiblingOrLastChild = parent.prevSiblingOrLastChild;
        if (was_first_child) {
            parent.parent.firstChild = invocation;
        } else if (invocation.prevSiblingOrLastChild) {
            invocation.prevSiblingOrLastChild.nextSibling = invocation;
        } else {
            assert(!parent.parent && this.tree === parent,
                'only the root node can be neither first child nor ' +
                'have a previous sibling');
        }
        if (was_last_child) {
            parent.parent.firstChild.prevSiblingOrLastChild = invocation;
        }

        // Disconnect the old node.
        parent.parent = null;
        parent.prevSiblingOrLastChild = null;
        parent.nextSibling = null;

        // Add new digrams.
        if (invocation.parent) {
            this.digrams.add(invocation.parent, invocation.index_slow, invocation);
        }
        for (let [i, child] of invocation.child_entries()) {
            this.digrams.add(invocation, i, child);
        }

        return invocation;
    }

    private replaceDigram(digram: Digram): Nonterminal {
        const debug = false;
        let new_rank = digram.parent.rank + digram.child.rank - 1;
        assert(this.digrams.max === null || new_rank <= this.digrams.max);

        // Build a new rule for the digram's pattern.
        const new_symbol = new Nonterminal(new_rank);
        this.rules.set(new_symbol, this.ruleBodyForPattern(new_symbol, digram));

        let debug_labels;
        if (debug) {
            console.log('new rule:');
            let debug_labels = new Map();
            debug_labels.set(new_symbol, '*NEW*');
            for (let [i, param] of new_symbol.formals.entries()) {
                debug_labels.set(param, `@${i}`);
            }
            debug_print(debug_labels, this.rules.get(new_symbol));
            console.log('whole tree before rewriting:');
            debug_print(debug_labels, this.tree);
        }

        // Rewrite the tree.
        let list = this.digrams.digram_list(digram);
        for (let parent of list.occ) {
            const invocation = this.rewrite(parent, digram, new_symbol);

            if (parent === this.tree) {
                this.tree = invocation;
            }

            if (debug) {
                console.log('did one substitution:');
                debug_print(debug_labels, invocation);
                console.log('whole tree is now:');
                debug_print(debug_labels, this.tree);
            }
        }

        // TODO: absorb assocs, produce new assocs

        return new_symbol;
    }
}

// Dumps a tree for debugging. May modify the label set to generate new labels.
export function debug_print(labels: Map<any, string>, root: Node, indent?: number) {
    let effective_indent = indent | 0;
    let label = labels.get(root.label);
    if (!label) {
        label = 'L' + labels.size;
        labels.set(root.label, label);
    }
    console.log('  '.repeat(effective_indent), label, root.debug_tag || '');
    for (let [i, child] of root.child_entries()) {
        debug_print(labels, child, effective_indent + 1);
    }
}

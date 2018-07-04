import * as assert from 'assert';
import * as Heap from 'heap';

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
    for (let [digram, list] of grammar.digrams.digrams) {
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
    readonly frequency: Heap<Digram>;

    constructor(root: Node, options?: { maxRank: number }) {
        this.table = new DigramTable;
        this.digrams = new Map;
        this.max = options ? options.maxRank : null;
        this.frequency = new Heap((a: DigramList, b: DigramList): number => b.occ.size - a.occ.size);

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
        let best = this.frequency.pop();
        return best ? best.digram : null;
        /*
        let best = null;
        // TODO(dpc): This should be replaced with a min-heap or something.
        for (let list of this.digrams.values()) {
            if ((!best || best.occ.size < list.occ.size) && list.occ.size > 1) {
                best = list;
            }
        }
        return best ? best.digram : null;
*/
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

    addNode(node: Node) {
        if (node.parent) {
            this.add(node.parent, node.index_slow, node);
        }
        for (let [i, child] of node.child_entries()) {
            this.add(node, i, child);
        }
    }

    removeNode(node: Node) {
        if (node.parent) {
            this.remove(node.parent, node.index_slow, node);
        }
        for (let [i, child] of node.child_entries()) {
            this.remove(node, i, child);
        }
    }
}

// Statistics about how a rule is used and how much it saves.
// Statistics for the implicit start symbol have symbol `null`.
class RuleStats {
    symbol?: Nonterminal;
    ref_count: number;
    size: number;

    constructor(symbol: Nonterminal) {
        this.symbol = symbol;
        this.ref_count = 0;
        this.size = 0;
    }
};

export class Grammar {
    rules: Map<Nonterminal, Node>;
    tree: Node;
    digrams: Digrams;
    stats: Map<Nonterminal, RuleStats>;
    // Maps non-terminals to the set of productions they reference.
    graph: Map<Nonterminal, Set<Nonterminal>>;

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
    private rewrite(parent: Node, digram: Digram, new_symbol: Nonterminal, debug_labels: Map<Symbol, string>): Node {
        const debug = !!debug_labels;
        if (debug) {
            console.log(`digram index = ${digram.index}`);
            if (parent.parent) {
                console.log(`will rewrite ${parent.index_slow}-th child:`);
                debug_print(debug_labels, parent.parent);
            } else {
                console.log(`will rewrite root:`);
                debug_print(debug_labels, parent);
            }
        }

        let was_first_child = parent.parent && parent.parent.firstChild === parent;
        let was_last_child = parent.parent && parent.parent.lastChild === parent;

        // Remove this node from the digram graph; it is going away.
        this.digrams.removeNode(parent);

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
                this.digrams.removeNode(child);
                // Lift its children, if any.
                for (let [j, grandchild] of child.child_entries()) {
                    prev = adopt_child(child, j, grandchild, prev);
                }
            } else {
                prev = adopt_child(parent, i, child, prev);
            }
        }

        if (invocation.firstChild) {
            invocation.firstChild.prevSiblingOrLastChild = prev;
            prev.nextSibling = null;
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
        if (debug) {
            console.log('invocation:');
            debug_print(debug_labels, invocation);
        }
        this.digrams.addNode(invocation);

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
            debug_labels = new Map();
            debug_labels.set(new_symbol, `S${this.rules.size}`);
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
            const invocation = this.rewrite(parent, digram, new_symbol, debug_labels);

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

        return new_symbol;
    }

    // Walks the grammar and records statistics:
    // - Number of references to a nonterminal.
    // - "Savings" of each rule.
    // - Hierarchical order.
    compute_stats(): void {
        // key => value means non-terminal 'key' appears in grammar rule 'value'
        let graph = new Map<Nonterminal, Set<Nonterminal>>();
        let add_edge = (from: Nonterminal, to: Nonterminal): void => {
            if (!to) {
                // This is an edge to the start rule; we always
                // process the start rule and do not need to record
                // it.
                return;
            }
            let users = graph.get(from);
            if (!users) {
                users = new Set<Nonterminal>();
                graph.set(from, users);
            }
            users.add(to);
        };

        this.graph = new Map<Nonterminal, Set<Nonterminal>>();

        this.stats = new Map<Nonterminal, RuleStats>();
        this.stats.set(null, new RuleStats(null));
        for (let symbol of this.rules.keys()) {
            this.graph.set(symbol, new Set());
            this.stats.set(symbol, new RuleStats(symbol));
        }

        let visit = (stats: RuleStats, body: Node): void => {
            stats.size++;
            if (body.label instanceof Nonterminal) {
                this.stats.get(body.label).ref_count++;
                add_edge(body.label, stats.symbol);
            }
            for (let child = body.firstChild; child; child = child.nextSibling) {
                visit(stats, child);
            }
        };
        visit(this.stats.get(null), this.tree);
        for (let [symbol, body] of this.rules) {
            visit(this.stats.get(symbol), body);
        }

        // Now invert the graph
        for (let [from, tos] of graph) {
            for (let to of tos) {
                this.graph.get(to).add(from);
            }
        }

        // TODO(dpc): Add a heap.
    }

    // Erases a rule from the grammar by applying it. Note, after
    // pruning, the digrams chart is no longer maintained.
    prune(symbol: Nonterminal): void {
        const body = this.rules.get(symbol);
        this.rules.delete(symbol);
        assert(body, 'pruned rule not in table');
        for (let [s, rule] of this.rules) {
            this.rules.set(s, apply_rule(rule, symbol, body));
        }
        this.tree = apply_rule(this.tree, symbol, body);
    }
}

// TODO(dpc): Maybe apply_rule should use an overlay tree of instances too.

// Applies a rule to `tree` and returns the new tree. This reuses
// `tree`, which may be destructively modified.
function apply_rule(tree: Node, symbol: Nonterminal, replacement: Node): Node {
    let mapper = (node) => {
        node = apply_rule_at(node, symbol, replacement);
        map_children(node, mapper);
        return node;
    };
    return mapper(tree);
}

// Applies a rule if it matches exactly at `node`.
function apply_rule_at(node: Node, symbol: Nonterminal, replacement: Node): Node {
    if (node.label !== symbol) {
        return node;
    }
    const args = Array.from(node.child_entries());
    const replacements = new Map<Parameter, Node>();
    for (let param of symbol.formals) {
        replacements.set(param, args[replacements.size][1]);
    }
    return clone_tree(replacement, replacements);
}

// Produces a clone of `tree`; if a node labeled with a key of
// `replacements` appears it is replaced. Note, the replacements are
// not cloned.
function clone_tree(tree: Node, replacements: Map<Parameter, Node>) {
    if (tree.label instanceof Parameter && replacements.has(tree.label)) {
        let replacement = replacements.get(tree.label);
        // Steal the replacement node.
        replacements.delete(tree.label);
        replacement.prevSiblingOrLastChild = null;
        replacement.nextSibling = null;
        replacement.parent = null;
        return replacement;
    }
    const clone = new Node(tree.label);
    for (let child = tree.firstChild; child; child = child.nextSibling) {
        clone.appendChild(clone_tree(child, replacements));
    }
    return clone;
}

// Rewrites tree by mapping its children 1:1. The walk relies on
// pointers being intact so do not modify the next sibling pointer of
// the argument. `map_children` establishes those links again, so it
// is OK to return disconnected nodes; they will be wired up.
function map_children(tree: Node, f: ((Node) => Node)): void {
    let prev = null;
    for (let [i, child] of tree.child_entries()) {
        let new_child = f(child);
        if (i == 0) {
            tree.firstChild = new_child;
        } else {
            assert(prev);
            prev.nextSibling = new_child;
        }
        new_child.prevSiblingOrLastChild = prev;
        prev = new_child;
    }
    if (tree.firstChild) {
        tree.firstChild.prevSiblingOrLastChild = prev;
        prev.nextSibling = null;
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

import * as tr from './treerepair';

import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import { DigramTable, check_digram_step } from './treerepair';

// Manufactures a tree for testing.
function t(label: tr.Symbol, debug_tag: string, ...children: tr.Node[]) {
    const rank = children.length;
    if (label == null) {
        label = new tr.Terminal(rank);
    }
    const node = new tr.Node(label);
    node.debug_tag = debug_tag;
    children.forEach(child => {
        node.appendChild(child);
    });
    return node;
}

// Serializes a node iterator to its debug labels.
function serialize(xs: Iterable<tr.Node>): string[] {
    return Array.from(xs, x => x.debug_tag);
}

// Serializes a node iterator to its debug labels.
function serialize_labels_tags(xs: Iterable<tr.Node>): [tr.Symbol, string][] {
    let mapper: ((n: tr.Node) => [tr.Symbol, string]) =
        x => [x.label, x.debug_tag];
    return Array.from(xs, mapper);
}

describe('pre_order', () => {
    it('should not produce anything for an empty tree', () => {
        expect(serialize(tr.pre_order(null))).to.deep.equal([]);
    });
    it('should produce parents before children', () => {
        const tree =
            t(null, 'p',
                t(null, 'q',
                    t(null, 'r'),
                    t(null, 's')),
                t(null, 't'));
        expect(serialize(tr.pre_order(tree))).to.deep.equal(
            ['p', 'q', 'r', 's', 't']
        );
    });
});

describe('post_order', () => {
    it('should produce children before parents', () => {
        const tree =
            t(null, 'p',
                t(null, 'q',
                    t(null, 'r'),
                    t(null, 's')),
                t(null, 't'));
        expect(serialize(tr.post_order(tree))).to.deep.equal(
            ['r', 's', 'q', 't', 'p']
        );
    });
});

describe('check_tree', () => {
    it('should be able to detect cycles', () => {
        const tree =
            t(null, 'p',
                t(null, 'q',
                    t(null, 'r'),
                    t(null, 's')),
                t(null, 't'));
        const s = tree.debug_find('s');
        s.nextSibling = tree;
        tree.prevSiblingOrLastChild = s;
        tree.parent = s.parent;

        expect(() => tr.check_tree(tree)).to.throw(Error, 'cycle');
    });

    it('should succeed on valid trees', () => {
        const tree =
            t(null, 'p',
                t(null, 'q',
                    t(null, 'r'),
                    t(null, 's')),
                t(null, 't'));
        tr.check_tree(tree);
    });

    it('should detect the wrong rank of children', () => {
        const root = new tr.Node(new tr.Terminal(3));
        root.debug_tag = 'root';
        const child = new tr.Node(new tr.Terminal(0));
        root.appendChild(child);
        expect(() => tr.check_tree(root)).to.throw(Error, 'rank 3 node root had 1 children');
    });
});

describe('check_digrams', () => {
    const A = new tr.Terminal(2);
    const B = new tr.Terminal(0);
    let root, a_child;

    beforeEach(() => {
        root =
            t(A, 'a (root)',
                t(B, 'b',
                    t(B, 'b (child)')),
                t(A, 'a (child)',
                    t(B, 'd')));
        a_child = root.debug_find('a (child)');
        root.nextDigram[0] = a_child;
        a_child.prevDigram[0] = root;
    });

    it('should accept a correct digram step', () => {
        tr.check_digram_step(root);
    });

    it('should detect a digram step with a mismatched label', () => {
        root.nextDigram[0] = root.debug_find('b');
        expect(() => tr.check_digram_step(root)).to.throw(Error, 'mismatched parent');
    });

    it('should detect a digram step with a broken back link', () => {
        a_child.prevDigram[0] = null;
        expect(() => tr.check_digram_step(root)).to.throw(Error, 'broken back link');
    });
});

describe('DigramTable', () => {
    it('should intern digrams', () => {
        const a = new tr.Terminal(2);
        const b = new tr.Terminal(0);
        const table = new tr.DigramTable();
        const a1b = table.get(a, 1, b);
        expect(table.get(a, 1, b)).to.equal(a1b);
    });

    it('should check digrams have consistent ranks', () => {
        const a = new tr.Terminal(2);
        const b = new tr.Terminal(3);
        const table = new tr.DigramTable();
        expect(() => table.get(a, 2, b)).to.throw(Error, 'index 2 out of range rank=2');
    });
});

describe('Digrams', () => {
    it('should build lists of digrams', () => {
        const A = new tr.Terminal(2);
        const B = new tr.Terminal(1);
        const C = new tr.Terminal(0);
        const root =
            t(A, 'p',
                t(B, 'q',
                    t(C, 'r')),
                t(A, 's',
                    t(B, 't',
                        t(C, 'u')),
                    t(B, 'v',
                        t(C, 'w'))));
        let digrams = new tr.Digrams(root);

        // The digram lists should be consistent.
        // TODO(dpc): Replace this with a whole table check.
        for (let node of tr.pre_order(root)) {
            check_digram_step(node);
        }

        let a0b = digrams.table.get(A, 0, B);
        expect(digrams.count(a0b)).to.equal(2);
        let b0c = digrams.table.get(B, 0, C);
        expect(digrams.count(b0c)).to.equal(3);

        // The most profitable digram to replace is b0c.
        expect(digrams.best()).to.equal(b0c);
    });

    it('should filter overlapping digrams', () => {
        const A = new tr.Terminal(1);
        const B = new tr.Terminal(0);
        const root =
            t(A, 'p',
                t(A, 'q',
                    t(A, 'r',
                        t(A, 's',
                            t(B, 'z')))));

        let digrams = new tr.Digrams(root);

        // The digram lists should be consistent.
        // TODO(dpc): Replace this with a whole table check.
        for (let node of tr.pre_order(root)) {
            check_digram_step(node);
        }

        let a0a = digrams.table.get(A, 0, A);
        expect(digrams.count(a0a)).to.equal(2);
    });

    it('should not produce digrams over maximal rank', () => {
        const A = new tr.Terminal(3);
        const B = new tr.Terminal(0);
        const root =
            t(A, 'p',
                t(B, 'q'),
                t(A, 'r',
                    t(B, 's'),
                    t(B, 't'),
                    t(B, 'u')),
                t(A, 'v',
                    t(B, 'w'),
                    t(B, 'x'),
                    t(B, 'y')));

        let digrams = new tr.Digrams(root, { maxRank: 1 });

        // The digram lists should be consistent.
        // TODO(dpc): Replace this with a whole table check.
        for (let node of tr.pre_order(root)) {
            check_digram_step(node);
        }

        expect(digrams.best()).to.equal(null);
    });
});

describe('Grammar', () => {
    it('rewrites should produce productions', () => {
        const A = new tr.Terminal(3);
        const B = new tr.Terminal(0);
        const root =
            t(A, 'p',
                t(B, 'q'),
                t(A, 'r',
                    t(B, 's'),
                    t(B, 't'),
                    t(B, 'u')),
                t(A, 'v',
                    t(B, 'w'),
                    t(B, 'x'),
                    t(B, 'y')));

        let grammar = new tr.Grammar(root);

        let digram = grammar.digrams.best();
        expect(digram).to.equal(grammar.digrams.table.get(A, 0, B));
        let occ = grammar.digrams.digram_list(digram).occ;
        let expected_occ = new Set([
            root.debug_find('p'),
            root.debug_find('r'),
            root.debug_find('v')
        ]);
        expect(occ.size).to.equal(expected_occ.size);
        for (let expected_occ_node of expected_occ) {
            expect(occ.has(expected_occ_node)).to.equal(true);
        }

        let S = grammar.replaceBestDigram();
        // There are three instances of A1B; they should be rewritten
        // like this:
        const rewritten =
            t(S, undefined,
                t(S, undefined,
                    t(B, 't'),
                    t(B, 'u')),
                t(S, undefined,
                    t(B, 'x'),
                    t(B, 'y')));

        //tr.debug_print(new Map([[S, 'S'], [A, 'A'], [B, 'B']]), grammar.tree);
        //tr.debug_print(new Map([[S, 'S'], [A, 'A'], [B, 'B']]), rewritten);

        expect(serialize_labels_tags(tr.pre_order(grammar.tree))).to.deep.equal(
            serialize_labels_tags(tr.pre_order(rewritten)));
    });

    it('should rewrite examples from the TreeRePair paper', () => {
        // Set `debug` to true to print the algorithm as it operates
        const debug = false;

        // TreeRePair Fig. 7.
        const BOOKS = new tr.Terminal(5);
        const BOOK = new tr.Terminal(3);
        const AUTHOR = new tr.Terminal(0);
        const TITLE = new tr.Terminal(0);
        const ISBN = new tr.Terminal(0);
        const root =
            t(BOOKS, undefined,
                t(BOOK, undefined,
                    t(AUTHOR, undefined),
                    t(TITLE, undefined),
                    t(ISBN, undefined)),
                t(BOOK, undefined,
                    t(AUTHOR, undefined),
                    t(TITLE, undefined),
                    t(ISBN, undefined)),
                t(BOOK, undefined,
                    t(AUTHOR, undefined),
                    t(TITLE, undefined),
                    t(ISBN, undefined)),
                t(BOOK, undefined,
                    t(AUTHOR, undefined),
                    t(TITLE, undefined),
                    t(ISBN, undefined)),
                t(BOOK, undefined,
                    t(AUTHOR, undefined),
                    t(TITLE, undefined),
                    t(ISBN, undefined)));

        let grammar = new tr.Grammar(root);

        let labels = new Map([[BOOKS, 'BOOKS'], [BOOK, 'BOOK'], [AUTHOR, 'AUTHOR'], [TITLE, 'TITLE'], [ISBN, 'ISBN']]);

        if (debug) {
            tr.debug_print(labels, grammar.tree);
        }
        let new_sym;
        let num_params = 0;
        do {
            tr.check_tree(grammar.tree);
            tr.check_digrams(labels, grammar);
            for (let rule of grammar.rules.values()) {
                tr.check_tree(rule);
            }

            new_sym = grammar.replaceBestDigram();
            if (debug) {
                console.log('-'.repeat(20));
                tr.debug_print(labels, grammar.tree);
                console.log('grammar:');
                for (let [symbol, rule] of grammar.rules.entries()) {
                    symbol.formals.forEach(s => labels.set(s, `p${num_params++}`));
                    console.log(labels.get(symbol), symbol.formals.map(s => labels.get(s)), '::=');
                    tr.debug_print(labels, rule);
                }
            }
        } while (new_sym);
    });
});

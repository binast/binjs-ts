import * as tr from './treerepair';

import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';
import { DigramTable } from './treerepair';

// Manufactures a tree for testing.
function t(label: tr.Symbol, debug_tag: string, ...children: tr.Node[]) {
    const rank = children.length;
    if (label == null) {
        label = new tr.Terminal(rank);
    }
    const node = new tr.Node(label);
    node.debug_tag = debug_tag;
    let prev: tr.Node = null;
    if (children.length) {
        node.firstChild = children[0];
    }
    children.forEach(child => {
        child.parent = node;
        child.prevSibling = prev;
        if (prev) {
            prev.nextSibling = child;
        }
        prev = child;
    });
    if (prev) {
        prev.nextSibling = null;
    }
    return node;
}

// Serializes a node iterator to its debug labels.
function serialize(xs: Iterable<tr.Node>): string[] {
    return Array.from(xs, x => x.debug_tag);
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
        tree.prevSibling = s;
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
        child.parent = root;
        root.firstChild = child;
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

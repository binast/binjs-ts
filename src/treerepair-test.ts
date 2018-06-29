import * as tr from './treerepair';

import { describe, it } from 'mocha';
import { expect } from 'chai';

// Manufactures a tree for testing.
function t(debug_tag: string, ...children: tr.Node[]) {
    const rank = children.length;
    const label = new tr.Terminal(rank);
    const node = new tr.Node(label);
    node.debug_tag = debug_tag;
    let prev: tr.Node = null;
    if (children.length) {
        prev = node.firstChild = children[0];
    }
    children.forEach((child, i) => {
        child.index = i;
        child.parent = node;
        child.prevSibling = prev;
        prev.nextSibling = child;
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
            t('p',
                t('q',
                    t('r'),
                    t('s')),
                t('t'));
        expect(serialize(tr.pre_order(tree))).to.deep.equal(
            ['p', 'q', 'r', 's', 't']
        );
    });
});

describe('post_order', () => {
    it('should produce children before parents', () => {
        const tree =
            t('p',
                t('q',
                    t('r'),
                    t('s')),
                t('t'));
        expect(serialize(tr.post_order(tree))).to.deep.equal(
            ['r', 's', 'q', 't', 'p']
        );
    });
});

describe('check_tree', () => {
    it('should be able to detect cycles', () => {
        const tree =
            t('p',
                t('q',
                    t('r'),
                    t('s')),
                t('t'));
        const s = tree.debug_find('s');
        s.nextSibling = tree;
        tree.prevSibling = s;
        tree.parent = s.parent;

        expect(() => tr.check_tree(tree)).to.throw('cycle');
    });
});

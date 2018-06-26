export function rewriteAst(node: any, f: (any) => any): any {
    if (node instanceof Array) {
        for (let i = 0; i < node.length; i++) {
            node[i] = rewriteAst(node[i], f);
        }
    } else if (typeof node == 'object') {
        for (let prop of Object.getOwnPropertyNames(node)) {
            node[prop] = rewriteAst(node[prop], f);
        }
    }
    return f(node);
}

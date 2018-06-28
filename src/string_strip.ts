// Strips the strings from an AST into a separate stream, rewriting
// the AST to leave a reference to the StringStripper in their place.
export class StringStripper {
    readonly strings: string[];

    constructor() {
        this.strings = [];
    }

    // Note, this modifies 'node'.
    // TODO(dpc): De-duplicate the string table thing with this.
    visit(node: any): any {
        if (typeof node === 'string') {
            this.strings.push(node);
            return this;
        }
        if (typeof node === 'number' ||
            typeof node === 'boolean' ||
            node === null ||
            node === undefined) {
            return node;
        }
        for (let property of Object.keys(node)) {
            node[property] = this.visit(node[property]);
        }
        return node;
    }
}

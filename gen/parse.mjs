import * as fs from 'fs';
import parse, {EmptyLine, Globals, JASSFunction, Native, Type, Variable} from 'jass-to-ast';

const types = [];
const natives = ['UnitAlive'];
const bjs = [];

/** @param {string} path */
const parseFile = path => {
    const ast = parse(fs.readFileSync(path, {encoding: 'utf8', flag: 'r'}));

    /**
     * @param node
     * @return boolean
     */
    const convert = node => {
        if (node instanceof EmptyLine) return true;
        if (node instanceof String) return true;
        if (node instanceof Variable) return true;

        if (node instanceof Type) {
            types.push(node.base);
            return true;
        }

        if (node instanceof Native) {
            natives.push(node.name);
            return true;
        }

        if (node instanceof JASSFunction) {
            bjs.push(node.name);
            return true;
        }

        console.log('Wrong node', node);
        return false;
    };

    for (const node of ast) {
        if (node instanceof Globals) {
            if (node.globals) {
                for (const global of node.globals) {
                    if (!convert(global)) break;
                }
            }
            continue;
        }

        if (!convert(node)) break;
    }
};

parseFile('./../static/common.j');
parseFile('./../static/blizzard.j');

const tmLanguage = '../src/jass.tmLanguage.json';

/** @type {{}} */
const json = JSON.parse(fs.readFileSync(tmLanguage, {encoding: 'utf8'}));

// noinspection JSUnresolvedReference
/** @type {{}} */
const repository = json.repository.jass.repository;

repository['bj-function'].match = `\\b(${bjs.join('|')})\\b`;
repository['native-function'].match = `\\b(${natives.join('|')})\\b`;
repository['type'].match = `\\b(${types.join('|')})\\b`;

fs.writeFileSync(tmLanguage, JSON.stringify(json, null, 4), {flag: 'w+'});

// natives

console.log(natives.length);
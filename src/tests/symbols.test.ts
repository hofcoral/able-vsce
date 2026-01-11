import { strict as assert } from 'assert';
import { parseSymbols, getMemberCandidates } from '../symbols';

const sample = `
class User:
    fun name(this):
        return "ok"

fun greet():
    return "hi"

user = User()
config = {
    host: "localhost",
    "port": 8080,
}
`;

const symbols = parseSymbols(sample);

assert(symbols.classes.has('User'));
assert(symbols.functions.has('greet'));
assert.equal(symbols.variableTypes.get('user'), 'User');
assert(symbols.objectProperties.get('config')?.has('host'));
assert(symbols.objectProperties.get('config')?.has('port'));

const userMembers = getMemberCandidates(symbols, 'user');
assert(userMembers.methods.includes('name'));

const configMembers = getMemberCandidates(symbols, 'config');
assert(configMembers.properties.includes('host'));
assert(configMembers.properties.includes('port'));

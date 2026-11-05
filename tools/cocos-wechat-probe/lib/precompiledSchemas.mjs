import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const require = createRequire(import.meta.url);

/** Capture the actual Node-side compiler module closure, separately from esbuild's runtime inputs. */
function compilerDependencyPaths() {
  const visited = new Set();
  function visit(module) {
    if (!module?.filename || visited.has(module.filename)) return;
    visited.add(module.filename);
    for (const child of module.children) visit(child);
  }
  for (const name of ['ajv/dist/2020.js', 'ajv/dist/standalone/index.js', 'ajv/package.json']) {
    require(name);
    visit(require.cache[require.resolve(name)]);
  }
  return [...visited].sort();
}

/** The returned code is authentic Ajv standalone output with safe ESM export names. */
export function compileWechatSchemas(schemas) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true, loopRequired: 1, code: { source: true, esm: true } });
  const sources = [];
  const exports = [];
  const ids = new Set();
  for (const [index, [path, schema]] of Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b)).entries()) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || typeof schema.$id !== 'string' || !schema.$id.trim()) {
      throw new Error('ERR_WECHAT_PRECOMPILED_SCHEMA_ID_INVALID:' + path);
    }
    if (ids.has(schema.$id)) throw new Error('ERR_WECHAT_PRECOMPILED_SCHEMA_ID_DUPLICATE:' + schema.$id);
    ids.add(schema.$id);
    sources.push([path, JSON.stringify(schema)]);
    exports.push(['schema_' + String(index).padStart(3, '0'), schema.$id]);
    ajv.addSchema(schema, schema.$id);
  }
  const exportMap = Object.fromEntries(exports);
  const schemaSources = Object.fromEntries(sources);
  const generated = standaloneCode(ajv, exportMap);
  const validatorEntries = exports.map(([name, id]) => '[' + JSON.stringify(id) + ',' + name + ']').join(',');
  const moduleCode = generated + '\nexport const precompiledValidators = Object.freeze({\n'
    + 'format:"runtime-precompiled-schemas/v1",\n'
    + 'schemaSources:Object.freeze(JSON.parse(' + JSON.stringify(JSON.stringify(schemaSources)) + ')),\n'
    + 'validators:Object.freeze(Object.fromEntries([' + validatorEntries + ']))\n});\n';
  return { moduleCode, schemaSources, exportMap, schemaIds: [...ids],
    compiler: { name: 'ajv', version: require('ajv/package.json').version, mode: 'standalone-esm',
      options: { strict: false, allErrors: true, allowUnionTypes: true, loopRequired: 1, code: { source: true, esm: true } } },
    compilerDependencyPaths: compilerDependencyPaths() };
}

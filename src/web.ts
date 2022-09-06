import { parse } from '@babel/core';
import generate from '@babel/generator';
import { inlineWasm, transformAst, Kind } from './helper';


/**
 * Transform bundler bg.js to esm-async module
 * @param code - source code
 * @param wasmData - wasm code in base64
 * @returns Generated code
 */
export function transform(code: string, wasmData?: string) {
  const {
    ast,
    wasmFilename,
    wasmExportName,
    exportNames,
    memviews,
  } = transformAst(parse(code, { sourceType: 'module' }), Kind.Web);

  const middle = generate(ast).code;
  return `
let ${wasmExportName};
${middle}
function getImports() {
    const imports = {};
    imports["./${wasmFilename}.js"] = {};
${exportNames.map(name => `    imports["./${wasmFilename}.js"].${name}=${name}`).join("\n")}
    return imports;
}

async function load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("\`WebAssembly.instantiateStreaming\` failed because your server does not serve wasm with \`application/wasm\` MIME type. Falling back to \`WebAssembly.instantiate\` which is slower. Original error:\\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

export default async function init(input) {
    const imports = getImports();

    ${generateLoadWasm(wasmFilename, wasmData)}
    const { instance, module } = await load(await input, imports);

    init.__${wasmExportName} = ${wasmExportName} = instance.exports;
    init.__wbindgen_wasm_module = module;
${memviews.map(v => `    ${v};`).join("\n")}
    
    return imports["./${wasmFilename}.js"];
}
  `;
}

function generateLoadWasm(wasmFilename: string, wasmData?: string) {
  if (wasmData) {
    return inlineWasm(wasmData, Kind.Web);
  } else {
    return `
    if (typeof input === 'undefined') {
        input = new URL('${wasmFilename}.wasm', import.meta.url);
    }
    
    if (typeof input === 'string' || (typeof Request === 'function' && input instanceof Request) || (typeof URL === 'function' && input instanceof URL)) {
        input = fetch(input);
    }`;
  }
}
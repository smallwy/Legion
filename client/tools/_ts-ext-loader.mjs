/** 让 node 直接跑 assets 里不带扩展名的 TypeScript import。只给离线断言用。 */
export async function resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
}

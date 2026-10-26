const version = process.versions.node;
if (Number(version.split('.')[0]) !== 24) {
  console.error(`Node.js 24 necessário. Versão atual: ${version}. Use a versão indicada em .nvmrc.`);
  process.exitCode = 1;
} else {
  console.log(`Node.js runtime confirmado: v${version} (24.x).`);
}

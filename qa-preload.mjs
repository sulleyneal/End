import { ProxyAgent, setGlobalDispatcher } from 'undici';
import fs from 'node:fs';
const ca = fs.readFileSync('/root/.ccr/ca-bundle.crt');
setGlobalDispatcher(new ProxyAgent({ uri: process.env.HTTPS_PROXY, requestTls: { ca }, proxyTls: { ca } }));

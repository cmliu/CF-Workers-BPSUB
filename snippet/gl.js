const FIXED_UUID = '';// 建议修改为自己的规范化UUID，如不需要可留空
let 反代IP = '';
let 启用SOCKS5反代 = null;
let 启用SOCKS5全局反代 = false;
let 我的SOCKS5账号 = '';
export default {
    async fetch(request) {
        try {
            const url = new URL(request.url);
            // 检查是否为 WebSocket 升级请求
            const upgradeHeader = request.headers.get('Upgrade');
            if (upgradeHeader !== 'websocket') {
                return new Response('Hello World!', { status: 200 });
            } else {
                let parsedSocks5Address = {};
                反代IP = 反代IP ? 反代IP : request.cf.colo + '.proxyIP.cmliuSSSS.NET';
                我的SOCKS5账号 = url.searchParams.get('socks5') || url.searchParams.get('http');
                启用SOCKS5全局反代 = url.searchParams.has('globalproxy') || 启用SOCKS5全局反代;
                if (url.pathname.toLowerCase().includes('/socks5=') || (url.pathname.includes('/s5=')) || (url.pathname.includes('/gs5='))) {
                    我的SOCKS5账号 = url.pathname.split('5=')[1];
                    启用SOCKS5反代 = 'socks5';
                    启用SOCKS5全局反代 = url.pathname.includes('/gs5=') ? true : 启用SOCKS5全局反代;
                } else if (url.pathname.toLowerCase().includes('/http=')) {
                    我的SOCKS5账号 = url.pathname.split('/http=')[1];
                    启用SOCKS5反代 = 'http';
                } else if (url.pathname.toLowerCase().includes('/socks://') || url.pathname.toLowerCase().includes('/socks5://') || url.pathname.toLowerCase().includes('/http://')) {
                    启用SOCKS5反代 = (url.pathname.includes('/http://')) ? 'http' : 'socks5';
                    我的SOCKS5账号 = url.pathname.split('://')[1].split('#')[0];
                    if (我的SOCKS5账号.includes('@')) {
                        const lastAtIndex = 我的SOCKS5账号.lastIndexOf('@');
                        let userPassword = 我的SOCKS5账号.substring(0, lastAtIndex).replaceAll('%3D', '=');
                        const base64Regex = /^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i;
                        if (base64Regex.test(userPassword) && !userPassword.includes(':')) userPassword = atob(userPassword);
                        我的SOCKS5账号 = `${userPassword}@${我的SOCKS5账号.substring(lastAtIndex + 1)}`;
                    }
                    启用SOCKS5全局反代 = true;//开启全局SOCKS5
                }

                if (我的SOCKS5账号) {
                    try {
                        parsedSocks5Address = await 获取SOCKS5账号(我的SOCKS5账号);
                        启用SOCKS5反代 = url.searchParams.get('http') ? 'http' : 启用SOCKS5反代;
                    } catch (err) {
                        启用SOCKS5反代 = null;
                    }
                } else {
                    启用SOCKS5反代 = null;
                }

                if (url.searchParams.has('proxyip')) {
                    反代IP = url.searchParams.get('proxyip');
                    启用SOCKS5反代 = null;
                } else if (url.pathname.toLowerCase().includes('/proxyip=')) {
                    反代IP = url.pathname.toLowerCase().split('/proxyip=')[1];
                    启用SOCKS5反代 = null;
                } else if (url.pathname.toLowerCase().includes('/proxyip.')) {
                    反代IP = `proxyip.${url.pathname.toLowerCase().split("/proxyip.")[1]}`;
                    启用SOCKS5反代 = null;
                } else if (url.pathname.toLowerCase().includes('/pyip=')) {
                    反代IP = url.pathname.toLowerCase().split('/pyip=')[1];
                    启用SOCKS5反代 = null;
                } else if (url.pathname.toLowerCase().includes('/ip=')) {
                    反代IP = url.pathname.toLowerCase().split('/ip=')[1];
                    启用SOCKS5反代 = null;
                }

                return await handleSPESSWebSocket(request, {
                    parsedSocks5Address,
                    启用SOCKS5反代,
                    启用SOCKS5全局反代,
                    反代IP,
                    ProxyPort: 443,
                });
            }
        } catch (err) {
            return new Response(err && err.stack ? err.stack : String(err), { status: 500 });
        }
    },
};

async function handleSPESSWebSocket(request, config) {
    const {
        parsedSocks5Address,
        启用SOCKS5反代,
        启用SOCKS5全局反代,
        反代IP,
        ProxyPort
    } = config;
    const ws配对 = new WebSocketPair();
    const [clientWS, serverWS] = Object.values(ws配对);

    serverWS.accept();

    // WebSocket心跳机制，每30秒发送一次
    let heartbeatInterval = setInterval(() => {
        if (serverWS.readyState === WS_READY_STATE_OPEN) {
            try {
                serverWS.send(new Uint8Array(0));
            } catch (e) { }
        }
    }, 30000);
    function clearHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }
    serverWS.addEventListener('close', clearHeartbeat);
    serverWS.addEventListener('error', clearHeartbeat);

    // 处理 WebSocket 数据流
    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
    const wsReadable = createWebSocketReadableStream(serverWS, earlyDataHeader);
    let remoteSocket = null;
    let udpStreamWrite = null;
    let isDns = false;

    wsReadable.pipeTo(new WritableStream({
        async write(chunk) {
            if (isDns && udpStreamWrite) {
                return udpStreamWrite(chunk);
            }
            if (remoteSocket) {
                try {
                    const writer = remoteSocket.writable.getWriter();
                    await writer.write(chunk);
                    writer.releaseLock();
                } catch (err) {
                    closeSocket(remoteSocket);
                    throw err;
                }
                return;
            }
            const result = parseVLESSHeader(chunk);
            if (result.hasError) throw new Error(result.message);
            if (result.addressRemote.includes(atob('c3BlZWQuY2xvdWRmbGFyZS5jb20='))) throw new Error('Access');
            const vlessRespHeader = new Uint8Array([result.vlessVersion[0], 0]);
            const rawClientData = chunk.slice(result.rawDataIndex);
            if (result.isUDP) {
                if (result.portRemote === 53) {
                    isDns = true;
                    const { write } = await handleUDPOutBound(serverWS, vlessRespHeader);
                    udpStreamWrite = write;
                    udpStreamWrite(rawClientData);
                    return;
                } else {
                    throw new Error('UDP代理仅支持DNS(端口53)');
                }
            }
            async function connectAndWrite(address, port) {
                const tcpSocket = await connect({ hostname: address, port: port }, { allowHalfOpen: true });
                remoteSocket = tcpSocket;
                const writer = tcpSocket.writable.getWriter();
                await writer.write(rawClientData);
                writer.releaseLock();
                return tcpSocket;
            }
            async function connectAndWriteSocks(address, port) {
                const tcpSocket = 启用SOCKS5反代 === 'socks5'
                    ? await socks5Connect(result.addressType, address, port, parsedSocks5Address)
                    : await httpConnect(result.addressType, address, port, parsedSocks5Address);
                remoteSocket = tcpSocket;
                const writer = tcpSocket.writable.getWriter();
                await writer.write(rawClientData);
                writer.releaseLock();
                return tcpSocket;
            }
            async function retry() {
                try {
                    let tcpSocket;
                    if (启用SOCKS5反代 === 'socks5') {
                        tcpSocket = await socks5Connect(result.addressType, result.addressRemote, result.portRemote, parsedSocks5Address);
                    } else if (启用SOCKS5反代 === 'http') {
                        tcpSocket = await httpConnect(result.addressType, result.addressRemote, result.portRemote, parsedSocks5Address);
                    } else {
                        const [反代IP地址, 反代IP端口] = await 解析地址端口(反代IP);
                        tcpSocket = await connect({ hostname: 反代IP地址, port: 反代IP端口 }, { allowHalfOpen: true });
                    }
                    remoteSocket = tcpSocket;
                    const writer = tcpSocket.writable.getWriter();
                    await writer.write(rawClientData);
                    writer.releaseLock();
                    tcpSocket.closed.catch(() => { }).finally(() => {
                        if (serverWS.readyState === WS_READY_STATE_OPEN) {
                            serverWS.close(1000, '连接已关闭');
                        }
                    });
                    pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, null);
                } catch (err) {
                    closeSocket(remoteSocket);
                    serverWS.close(1011, '代理连接失败: ' + (err && err.message ? err.message : err));
                }
            }
            try {
                if (启用SOCKS5全局反代) {
                    const tcpSocket = await connectAndWriteSocks(result.addressRemote, result.portRemote);
                    pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry);
                } else {
                    const tcpSocket = await connectAndWrite(result.addressRemote, result.portRemote);
                    pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry);
                }
            } catch (err) {
                closeSocket(remoteSocket);
                serverWS.close(1011, '连接失败: ' + (err && err.message ? err.message : err));
            }
        },
        close() {
            if (remoteSocket) {
                closeSocket(remoteSocket);
            }
        }
    })).catch(err => {
        closeSocket(remoteSocket);
        serverWS.close(1011, '内部错误: ' + (err && err.message ? err.message : err));
    });

    return new Response(null, {
        status: 101,
        webSocket: clientWS,
    });
}

function createWebSocketReadableStream(ws, earlyDataHeader) {
    return new ReadableStream({
        start(controller) {
            ws.addEventListener('message', event => {
                controller.enqueue(event.data);
            });

            ws.addEventListener('close', () => {
                controller.close();
            });

            ws.addEventListener('error', err => {
                controller.error(err);
            });

            if (earlyDataHeader) {
                try {
                    const decoded = atob(earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/'));
                    const data = Uint8Array.from(decoded, c => c.charCodeAt(0));
                    controller.enqueue(data.buffer);
                } catch (e) {
                }
            }
        }
    });
}

// 只允许固定UUID
function parseVLESSHeader(buffer) {
    if (buffer.byteLength < 24) {
        return { hasError: true, message: '无效的头部长度' };
    }
    const view = new DataView(buffer);
    const version = new Uint8Array(buffer.slice(0, 1));
    const uuid = formatUUID(new Uint8Array(buffer.slice(1, 17)));
    if (FIXED_UUID && uuid !== FIXED_UUID) {
        return { hasError: true, message: '无效的用户' };
    }
    const optionsLength = view.getUint8(17);
    const command = view.getUint8(18 + optionsLength);
    let isUDP = false;
    if (command === 1) {
    } else if (command === 2) {
        isUDP = true;
    } else {
        return { hasError: true, message: '不支持的命令，仅支持TCP(01)和UDP(02)' };
    }
    let offset = 19 + optionsLength;
    const port = view.getUint16(offset);
    offset += 2;
    const addressType = view.getUint8(offset++);
    let address = '';
    switch (addressType) {
        case 1:
            address = Array.from(new Uint8Array(buffer.slice(offset, offset + 4))).join('.');
            offset += 4;
            break;
        case 2:
            const domainLength = view.getUint8(offset++);
            address = new TextDecoder().decode(buffer.slice(offset, offset + domainLength));
            offset += domainLength;
            break;
        case 3:
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(view.getUint16(offset).toString(16).padStart(4, '0'));
                offset += 2;
            }
            address = ipv6.join(':').replace(/(^|:)0+(\w)/g, '$1$2');
            break;
        default:
            return { hasError: true, message: '不支持的地址类型' };
    }
    return {
        hasError: false,
        addressRemote: address,
        portRemote: port,
        rawDataIndex: offset,
        vlessVersion: version,
        isUDP,
        addressType
    };
}

async function pipeRemoteToWebSocket(remoteSocket, ws, vlessHeader, retry = null, retryCount = 0) {
    const MAX_RETRIES = 8;                      // 最大重试8次
    const MAX_CHUNK_SIZE = 128 * 1024;              // 单帧最大 128 KB
    const MAX_BUFFER_SIZE = 2 * 1024 * 1024;           // 最大缓存 2 MB
    const FLUSH_INTERVAL = 10;                  // ms，定期 flush
    const BASE_RETRY_DELAY = 200;             // ms，初始重试延迟

    let headerSent = false;
    let hasIncomingData = false;
    let bufferQueue = [];
    let bufferedBytes = 0;

    // --- 工具函数 ---

    const concatUint8Arrays = (chunks) => {
        if (chunks.length === 1) return chunks[0];
        const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
        }
        return merged;
    };

    // 分包发送（每帧 ≤ 128 KB）
    const sendInChunks = (data) => {
        let offset = 0;
        while (offset < data.byteLength) {
            const end = Math.min(offset + MAX_CHUNK_SIZE, data.byteLength);
            ws.send(data.slice(offset, end));
            offset = end;
        }
    };

    const flushBufferQueue = () => {
        if (ws.readyState !== WS_READY_STATE_OPEN || bufferQueue.length === 0) return;
        const merged = concatUint8Arrays(bufferQueue);
        bufferQueue = [];
        bufferedBytes = 0;
        sendInChunks(merged);
    };

    const flushTimer = setInterval(flushBufferQueue, FLUSH_INTERVAL);

    // --- 主读循环 ---
    const reader = remoteSocket.readable.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            hasIncomingData = true;
            if (ws.readyState !== WS_READY_STATE_OPEN) break;

            // 首包带 vlessHeader
            if (!headerSent) {
                const combined = new Uint8Array(vlessHeader.byteLength + value.byteLength);
                combined.set(new Uint8Array(vlessHeader), 0);
                combined.set(value, vlessHeader.byteLength);
                bufferQueue.push(combined);
                bufferedBytes += combined.byteLength;
                headerSent = true;
            } else {
                bufferQueue.push(value);
                bufferedBytes += value.byteLength;
            }

            // 缓存超过 2 MB 立即 flush
            if (bufferedBytes >= MAX_BUFFER_SIZE) {
                flushBufferQueue();
            }
        }

        reader.releaseLock();
        flushBufferQueue();
        clearInterval(flushTimer);

        // --- 关闭逻辑 ---
        if (!hasIncomingData && retry && retryCount < MAX_RETRIES) {
            const delay = BASE_RETRY_DELAY * Math.pow(2, retryCount);
            console.warn(`未收到数据，${delay} ms 后重试 (${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(r => setTimeout(r, delay));
            await retry();
            return;
        }

        if (ws.readyState === WS_READY_STATE_OPEN) ws.close(1000, '正常关闭');
    } catch (err) {
        reader.releaseLock();
        clearInterval(flushTimer);
        console.error('数据传输错误:', err);
        closeSocket(remoteSocket);

        if (retry && retryCount < MAX_RETRIES) {
            const delay = BASE_RETRY_DELAY * Math.pow(2, retryCount);
            console.warn(`错误重试 (${retryCount + 1}/${MAX_RETRIES})，将在 ${delay} ms 后重试`);
            await new Promise(r => setTimeout(r, delay));
            await retry();
            return;
        }

        if (ws.readyState === WS_READY_STATE_OPEN) {
            ws.close(1011, '数据传输错误');
        }
    }
}

function closeSocket(socket) {
    if (socket) {
        try {
            socket.close();
        } catch (e) {
        }
    }
}

function formatUUID(bytes) {
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function 获取SOCKS5账号(address) {
    const lastAtIndex = address.lastIndexOf("@");
    let [latter, former] = lastAtIndex === -1 ? [address, undefined] : [address.substring(lastAtIndex + 1), address.substring(0, lastAtIndex)];
    let username, password, hostname, port;
    if (former) {
        const formers = former.split(":");
        if (formers.length !== 2) {
            throw new Error('无效的 SOCKS 地址格式：认证部分必须是 "username:password" 的形式');
        }
        [username, password] = formers;
    }
    const latters = latter.split(":");
    if (latters.length > 2 && latter.includes("]:")) {
        port = Number(latter.split("]:")[1].replace(/[^\d]/g, ''));
        hostname = latter.split("]:")[0] + "]";
    } else if (latters.length === 2) {
        port = Number(latters.pop().replace(/[^\d]/g, ''));
        hostname = latters.join(":");
    } else {
        port = 80;
        hostname = latter;
    }

    if (isNaN(port)) {
        throw new Error('无效的 SOCKS 地址格式：端口号必须是数字');
    }
    const regex = /^\[.*\]$/;
    if (hostname.includes(":") && !regex.test(hostname)) {
        throw new Error('无效的 SOCKS 地址格式：IPv6 地址必须用方括号括起来，如 [2001:db8::1]');
    }
    return { username, password, hostname, port };
}

async function socks5Connect(addressType, addressRemote, portRemote, parsedSocks5Address) {
    const { username, password, hostname, port } = parsedSocks5Address;
    const socket = connect({
        hostname,
        port,
    });
    const socksGreeting = new Uint8Array([5, 2, 0, 2]);
    const writer = socket.writable.getWriter();
    await writer.write(socksGreeting);
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    let res = (await reader.read()).value;
    if (res[0] !== 0x05) {
        throw new Error(`socks server version error: ${res[0]} expected: 5`);
    }
    if (res[1] === 0xff) {
        throw new Error("no acceptable methods");
    }
    if (res[1] === 0x02) {
        if (!username || !password) {
            throw new Error("please provide username/password");
        }
        const authRequest = new Uint8Array([
            1,
            username.length,
            ...encoder.encode(username),
            password.length,
            ...encoder.encode(password)
        ]);
        await writer.write(authRequest);
        res = (await reader.read()).value;
        if (res[0] !== 0x01 || res[1] !== 0x00) {
            throw new Error("fail to auth socks server");
        }
    }
    let DSTADDR;
    switch (addressType) {
        case 1:
            DSTADDR = new Uint8Array(
                [1, ...addressRemote.split('.').map(Number)]
            );
            break;
        case 2:
            DSTADDR = new Uint8Array(
                [3, addressRemote.length, ...encoder.encode(addressRemote)]
            );
            break;
        case 3:
            DSTADDR = new Uint8Array(
                [4, ...addressRemote.split(':').flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]
            );
            break;
        default:
            throw new Error(`invalid addressType is ${addressType}`);
    }
    const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
    await writer.write(socksRequest);
    res = (await reader.read()).value;
    if (res[1] === 0x00) {
    } else {
        throw new Error("fail to open socks connection");
    }
    writer.releaseLock();
    reader.releaseLock();
    return socket;
}

async function httpConnect(addressType, addressRemote, portRemote, parsedSocks5Address) {
    const { username, password, hostname, port } = parsedSocks5Address;
    const sock = await connect({
        hostname: hostname,
        port: port
    });

    // 构建HTTP CONNECT请求
    let connectRequest = `CONNECT ${addressRemote}:${portRemote} HTTP/1.1\r\n`;
    connectRequest += `Host: ${addressRemote}:${portRemote}\r\n`;

    // 添加代理认证（如果需要）
    if (username && password) {
        const authString = `${username}:${password}`;
        const base64Auth = btoa(authString);
        connectRequest += `Proxy-Authorization: Basic ${base64Auth}\r\n`;
    }

    connectRequest += `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n`;
    connectRequest += `Proxy-Connection: Keep-Alive\r\n`;
    connectRequest += `Connection: Keep-Alive\r\n`; // 添加标准 Connection 头
    connectRequest += `\r\n`;

    try {
        // 发送连接请求
        const writer = sock.writable.getWriter();
        await writer.write(new TextEncoder().encode(connectRequest));
        writer.releaseLock();
    } catch (err) {
        console.error('发送HTTP CONNECT请求失败:', err);
        throw new Error(`发送HTTP CONNECT请求失败: ${err.message}`);
    }

    // 读取HTTP响应
    const reader = sock.readable.getReader();
    let respText = '';
    let connected = false;
    let responseBuffer = new Uint8Array(0);

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                console.error('HTTP代理连接中断');
                throw new Error('HTTP代理连接中断');
            }

            // 合并接收到的数据
            const newBuffer = new Uint8Array(responseBuffer.length + value.length);
            newBuffer.set(responseBuffer);
            newBuffer.set(value, responseBuffer.length);
            responseBuffer = newBuffer;

            // 将收到的数据转换为文本
            respText = new TextDecoder().decode(responseBuffer);

            // 检查是否收到完整的HTTP响应头
            if (respText.includes('\r\n\r\n')) {
                // 分离HTTP头和可能的数据部分
                const headersEndPos = respText.indexOf('\r\n\r\n') + 4;
                const headers = respText.substring(0, headersEndPos);

                // 检查响应状态
                if (headers.startsWith('HTTP/1.1 200') || headers.startsWith('HTTP/1.0 200')) {
                    connected = true;

                    // 如果响应头之后还有数据，我们需要保存这些数据以便后续处理
                    if (headersEndPos < responseBuffer.length) {
                        const remainingData = responseBuffer.slice(headersEndPos);
                        // 创建一个缓冲区来存储这些数据，以便稍后使用
                        const dataStream = new ReadableStream({
                            start(controller) {
                                controller.enqueue(remainingData);
                            }
                        });

                        // 创建一个新的TransformStream来处理额外数据
                        const { readable, writable } = new TransformStream();
                        dataStream.pipeTo(writable).catch(err => console.error('处理剩余数据错误:', err));

                        // 替换原始readable流
                        // @ts-ignore
                        sock.readable = readable;
                    }
                } else {
                    const errorMsg = `HTTP代理连接失败: ${headers.split('\r\n')[0]}`;
                    console.error(errorMsg);
                    throw new Error(errorMsg);
                }
                break;
            }
        }
    } catch (err) {
        reader.releaseLock();
        throw new Error(`处理HTTP代理响应失败: ${err.message}`);
    }

    reader.releaseLock();

    if (!connected) {
        throw new Error('HTTP代理连接失败: 未收到成功响应');
    }

    return sock;
}
async function handleUDPOutBound(webSocket, 协议响应头) {
    let isVlessHeaderSent = false;
    const transformStream = new TransformStream({
        start(controller) {
        },
        transform(chunk, controller) {
            for (let index = 0; index < chunk.byteLength;) {
                const lengthBuffer = chunk.slice(index, index + 2);
                const udpPacketLength = new DataView(lengthBuffer).getUint16(0);
                const udpData = new Uint8Array(
                    chunk.slice(index + 2, index + 2 + udpPacketLength)
                );
                index = index + 2 + udpPacketLength;
                controller.enqueue(udpData);
            }
        },
        flush(controller) {
        }
    });

    transformStream.readable.pipeTo(new WritableStream({
        async write(chunk) {
            const resp = await fetch('https://1.1.1.1/dns-query',
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/dns-message',
                    },
                    body: chunk,
                })
            const dnsQueryResult = await resp.arrayBuffer();
            const udpSize = dnsQueryResult.byteLength;
            const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);

            if (webSocket.readyState === WS_READY_STATE_OPEN) {
                if (isVlessHeaderSent) {
                    webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
                } else {
                    webSocket.send(await new Blob([协议响应头, udpSizeBuffer, dnsQueryResult]).arrayBuffer());
                    isVlessHeaderSent = true;
                }
            }
        }
    })).catch((error) => {
    });

    const writer = transformStream.writable.getWriter();

    return {
        write(chunk) {
            writer.write(chunk);
        }
    };
}

// ========== 必要常量和依赖 ==========
const WS_READY_STATE_OPEN = 1;
import { connect } from 'cloudflare:sockets';

async function 解析地址端口(proxyIP) {
    proxyIP = proxyIP.toLowerCase();
    let 地址 = proxyIP, 端口 = 443;
    if (proxyIP.includes('.tp')) {
        const tpMatch = proxyIP.match(/\.tp(\d+)/);
        if (tpMatch) 端口 = parseInt(tpMatch[1], 10);
        return [地址, 端口];
    }
    if (proxyIP.includes(']:')) {
        const parts = proxyIP.split(']:');
        地址 = parts[0] + ']';
        端口 = parseInt(parts[1], 10) || 端口;
    } else if (proxyIP.includes(':') && !proxyIP.startsWith('[')) {
        const colonIndex = proxyIP.lastIndexOf(':');
        地址 = proxyIP.slice(0, colonIndex);
        端口 = parseInt(proxyIP.slice(colonIndex + 1), 10) || 端口;
    }
    return [地址, 端口];
}
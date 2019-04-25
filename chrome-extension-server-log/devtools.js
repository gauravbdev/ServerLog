let PanelWindow;
const pageRefs = [];
chrome.devtools.network.onRequestFinished.addListener(requestHandler);

function requestHandler(request) {
    if (!PanelWindow) {
        return;
    }
    try {
        const headers = request.response.headers;

        // 响应头是否包含 X-Server-Log
        const headerLog = headers.find(item =>

            // HTTP 下是 X-Server-Log，HTTPS 下会自动变成 x-server-log，所以要忽略大小写
            item.name.toLowerCase() === 'x-server-log-data'
        );

        let logArr;
        let fragment;
        const keyword = PanelWindow.document.querySelector('#search')
            .value.replace(/(^\s*)|(\s*$)/g, '');
        const selectLevel = PanelWindow.document.querySelector('.level-wrap .active')
            .id;

        // 开启监听才继续
        try {
            const record = localStorage.serverlog_activeOn;
            if ((typeof record === 'undefined' || record === 'on') && headerLog) {
                logArr = JSON.parse(LZString.decompressFromEncodedURIComponent(headerLog.value));
                fragment = document.createDocumentFragment();

                // 保持日志
                const currentPage = request.pageref;
                if (pageRefs.indexOf(currentPage) === -1) {
                    pageRefs.push(currentPage);
                    const preserveOn = PanelWindow.document.querySelector('#check-preserve')
                        .checked;

                    // 对于新的导航或页面刷新，取消代码全屏和body的禁止滚动
                    const fulled = PanelWindow.document.querySelector('.resp-content.full');
                    if (fulled) {
                        fulled.classList.remove('full');
                        PanelWindow.document.body.classList.remove('noscroll');
                    }

                    if (!preserveOn) {
                        // 清除当前日志
                        PanelWindow.document.querySelector('#logs')
                            .innerHTML = '';
                        PanelWindow.document.querySelector('#total-count')
                            .textContent = '0';
                        PanelWindow.document.querySelector('#filter-info')
                            .textContent = '';
                    }
                }

                logArr.forEach(logObj => {
                    let child = document.createElement('div');
                    let msgStr = logObj.message;
                    const type = logObj.type ? logObj.type.toLowerCase() : 'info';
                    const category = logObj.category ? logObj.category : '';

                    if (!msgStr) {
                        return;
                    }

                    // 提取reqId，注意这里需要懒惰匹配
                    let reqId = '-';
                    if (/^{.+?} /.test(msgStr)) {
                        const matched = msgStr.match(/^{(.+?)} /);
                        if (matched.length === 2) {
                            reqId = matched[1];
                            msgStr = msgStr.replace(matched[0], '');
                        }
                    }

                    // 提取JSON
                    const tempObj = {};
                    if (/###([\s\S]+?)###/g.test(msgStr)) {
                        const matchedArr = msgStr.match(/###([\s\S]+?)###/g);
                        if (matchedArr) {
                            matchedArr.forEach((str, index) => {
                                const matched = str.match(/###([\s\S]+?)###/);
                                if (matched.length === 2) {
                                    const dataToReplace = `
                                    <div class="resp-content">
                                        <span class="resp-title">
                                            <a class="btn-link full-link"><i class="iconfont icon-full-screen"></i><span class="span-full">全屏</span></a>
                                        </span> 
                                        <pre style="display: none;"><code>${encodeURIComponent(matched[1])}</code></pre>
                                        <div class="editor"></div>
                                    </div>`;

                                    const key = `$serverlogFormatData${index}`;
                                    tempObj[key] = dataToReplace;
                                    msgStr = msgStr.replace(matched[0], key);
                                }
                            });
                        }
                    }

                    // 请求链接单独放在最后一行
                    if (/\(URL: (.+)\)$/.test(msgStr)) {
                        const matchedLink = msgStr.match(/\(URL: (.+)\)$/);
                        if (matchedLink.length === 2) {
                            msgStr = msgStr.replace(matchedLink[0], `<span class="req-uri"><i class="iconfont icon-link"></i> ${matchedLink[1]}</span>`);
                        }
                    }

                    // 将链接包装成a标签
                    const linkMatch = msgStr.match(/(https?:\/\/|www\.)[-a-zA-Z0-9@:%_\+.~#?&//=\u4e00-\u9fa5]+/g);
                    if (linkMatch && linkMatch.length > 0) {
                        linkMatch.forEach(link => {
                            msgStr = msgStr.replace(link, `<span class="link" data-link="${link}" title="按住Ctrl并单击可访问链接">${link}</span>`);
                        });
                    }

                    if (Object.keys(tempObj).length) {
                        for (let key in tempObj) {
                            msgStr = msgStr.replace(key, tempObj[key]);
                        }
                    }

                    // 判断 level
                    let matchLevel = true;
                    switch (selectLevel) {
                        case 'warn':
                            if (type !== 'warn' && type !== 'error') {
                                matchLevel = false;
                            }
                            break;
                        case 'error':
                            if (type !== 'error') {
                                matchLevel = false;
                            }
                            break;
                        default:
                    }

                    let style = '';
                    if ((logObj.time.indexOf(keyword) >= 0 ||
                        logObj.type.indexOf(keyword) >= 0 ||
                        (logObj.category || '')
                            .indexOf(keyword) >= 0 ||
                        msgStr.indexOf(keyword) >= 0) &&
                        matchLevel) {
                        style = '';
                    } else {
                        style = 'display: none;';
                    }

                    const html = [
                        `<li class="${type} log-li" style="${style}">`,
                        `<div class="log-content"><div class="log-title"><span class="time">${logObj.time}</span><span class="reqId">请求ID: ${reqId}</span></div>`,
                        `<div class="log-body"><span class="type" style="display: none;">[${logObj.type}]</span>`
                    ];

                    if (logObj.category) {
                        html.push(
                            `<span class="category">${logObj.category}</span> `);
                    }

                    html.push(
                        '<span class="split">- </span>',
                        `${msgStr}</div></div>`,
                        '<button class="copy" title="复制">复制</button>',
                        '</li>');

                    child.innerHTML = html.join('');
                    child = child.firstChild;
                    fragment.appendChild(child);
                });

                setTimeout(() => {
                    const logsDom = PanelWindow.document.querySelector('#logs');

                    // 将片段插入dom树
                    logsDom.appendChild(fragment);

                    // 超过最大日志数后移除最开始的日志
                    const maxLogs = 9999;
                    const totalNodes = logsDom.querySelectorAll('.log-li')
                        .length;
                    if (totalNodes > maxLogs) {
                        for (let i = 0; i < (totalNodes - maxLogs); i++) {
                            logsDom.removeChild(logsDom.children[0]);
                        }
                    }

                    // 设置当前日志数
                    PanelWindow.document.querySelector('#total-count')
                        .textContent = totalNodes;

                    let hiddenCount = 0;
                    const lis = Array.prototype.slice.call(PanelWindow.document.querySelectorAll('#logs li.log-li'));
                    lis.forEach(li => {
                        if (li.style.display === 'none') {
                            hiddenCount++;
                        }
                    });

                    // 没有筛选结果时提示
                    if (totalNodes > 0 && totalNodes === hiddenCount) {
                        PanelWindow.document.querySelector('#no-data')
                            .style.display = 'block';
                    } else {
                        PanelWindow.document.querySelector('#no-data')
                            .style.display = 'none';
                    }

                    if (hiddenCount > 0) {
                        PanelWindow.document.querySelector('#filter-info')
                            .textContent = `（${hiddenCount}条日志被筛选隐藏）`;
                    } else {
                        PanelWindow.document.querySelector('#filter-info')
                            .textContent = '';
                    }

                    // 自动滚屏
                    const scollOn = PanelWindow.document.querySelector('#check-scroll')
                        .checked;
                    if (scollOn) {
                        PanelWindow.scrollTo(0, PanelWindow.document.body.scrollHeight);
                    }
                }, 0);
            }
        } catch (e) {
            console.error(e);
        }
    } catch (e) {
        console.error(e);
    }
}

chrome.devtools.panels.create('ServerLog',
    '',
    'panel.html',
    panel => {
        panel.onShown.addListener(panelWindow => {
            PanelWindow = panelWindow;
        });
    });

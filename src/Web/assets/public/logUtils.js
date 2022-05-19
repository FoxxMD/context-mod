const SPLAT = window.beam.SPLAT;
const {combine, printf, timestamp, label, splat, errors} = window.format;

window.formattedTime = (short, full) => `<span class="has-tooltip"><span style="margin-top:35px" class='tooltip rounded shadow-lg p-1 bg-gray-100 text-black space-y-3 p-2 text-left'>${full}</span><span>${short}</span></span>`;
window.formatLogLineToHtml = (log, timestamp = undefined) => {
    const val = typeof log === 'string' ? log : log[window.beam.MESSAGE];
    const logContent = Autolinker.link(val, {
        email: false,
        phone: false,
        mention: false,
        hashtag: false,
        stripPrefix: false,
        sanitizeHtml: true,
    })
        .replace(/(\s*debug\s*):/i, '<span class="debug blue">$1</span>:')
        .replace(/(\s*warn\s*):/i, '<span class="warn yellow">$1</span>:')
        .replace(/(\s*info\s*):/i, '<span class="info green">$1</span>:')
        .replace(/(\s*error\s*):/i, '<span class="error red">$1</span>:')
        .replace(/(\s*verbose\s*):/i, '<span class="error purple">$1</span>:')
        .replaceAll('\n', '<br />');
    //.replace(HYPERLINK_REGEX, '<a target="_blank" href="$&">$&</a>');
    let line;

    let timestampString = timestamp;
    if(timestamp === undefined && typeof log !== 'string') {
        timestampString = log.timestamp;
    }

    if(timestampString !== undefined) {
        const timeStampReplacement = formattedTime(dayjs(timestampString).format('HH:mm:ss z'), timestampString);
        const splitLine = logContent.split(timestampString);
        line = `<div class="logLine">${splitLine[0]}${timeStampReplacement}<span style="white-space: pre-wrap">${splitLine[1]}</span></div>`;
    } else {
        line = `<div style="white-space: pre-wrap" class="logLine">${logContent}</div>`
    }
    return line;
}

window.formatNumber = (val, options) => {
    const {
        toFixed = 2,
        defaultVal = null,
        prefix = '',
        suffix = '',
        round,
    } = options || {};
    let parsedVal = typeof val === 'number' ? val : Number.parseFloat(val);
    if (Number.isNaN(parsedVal)) {
        return defaultVal;
    }
    let prefixStr = prefix;
    const {enable = false, indicate = true, type = 'round'} = round || {};
    if (enable && !Number.isInteger(parsedVal)) {
        switch (type) {
            case 'round':
                parsedVal = Math.round(parsedVal);
                break;
            case 'ceil':
                parsedVal = Math.ceil(parsedVal);
                break;
            case 'floor':
                parsedVal = Math.floor(parsedVal);
        }
        if (indicate) {
            prefixStr = `~${prefix}`;
        }
    }
    const localeString = parsedVal.toLocaleString(undefined, {
        minimumFractionDigits: toFixed,
        maximumFractionDigits: toFixed,
    });
    return `${prefixStr}${localeString}${suffix}`;
};
logFormatter = printf(({
                                   level,
                                   message,
                                   labels = ['App'],
                                   subreddit,
                                   bot,
                                   instance,
                                   leaf,
                                   itemId,
                                   timestamp,
                                   durationMs,
                                   // @ts-ignore
                                   [SPLAT]: splatObj,
                                   stack,
                                   ...rest
                               }) => {
    let stringifyValue = splatObj !== undefined ? JSON.stringify(splatObj) : '';
    let msg = message;
    let stackMsg = '';
    if (stack !== undefined) {
        const stackArr = stack.split('\n');
        const stackTop = stackArr[0];
        const cleanedStack = stackArr
            .slice(1) // don't need actual error message since we are showing it as msg
            .join('\n'); // rejoin with newline to preserve formatting
        stackMsg = `\n${cleanedStack}`;
        if (msg === undefined || msg === null || typeof message === 'object') {
            msg = stackTop;
        } else {
            stackMsg = `\n${stackTop}${stackMsg}`
        }
    }

    let nodes = labels;
    if (leaf !== null && leaf !== undefined && !nodes.includes(leaf)) {
        nodes.push(leaf);
    }
    const labelContent = `${nodes.map((x) => `[${x}]`).join(' ')}`;

    return `${timestamp} ${level.padEnd(7)}: ${instance !== undefined ? `|${instance}| ` : ''}${bot !== undefined ? `~${bot}~ ` : ''}${subreddit !== undefined ? `{${subreddit}} ` : ''}${labelContent} ${msg}${durationMs !== undefined ? ` Elapsed: ${durationMs}ms (${window.formatNumber(durationMs/1000)}s) ` : ''}${stringifyValue !== '' ? ` ${stringifyValue}` : ''}${stackMsg}`;
});

window.formatLog = (logObj) => {
    const formatted = logFormatter.transform(logObj);
    const html = window.formatLogLineToHtml(formatted);
    return {...formatted, html};
}

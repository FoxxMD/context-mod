import ExtendableError from "es6-error";

class InvalidRegexError extends ExtendableError {
    constructor(regex: RegExp | RegExp[], val?: string, url?: string, message?: string) {
        const msgParts = [
            message ?? 'Regex(es) did not match the value given.',
        ];
        let regArr = Array.isArray(regex) ? regex : [regex];
        for(const r of regArr) {
            msgParts.push(`Regex: ${r}`)
        }
        if (val !== undefined) {
            msgParts.push(`Value: ${val}`);
        }
        if (url !== undefined) {
            msgParts.push(`Sample regex: ${url}`);
        }
        super(msgParts.join('\r\n'));
    }
}

export default InvalidRegexError;

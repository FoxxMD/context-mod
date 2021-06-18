import ExtendableError from "es6-error";

class InvalidRegexError extends ExtendableError {
    constructor(regex: RegExp, val?: string, url?: string) {
        const msgParts = [
            'Regex did not match the value given.',
            `Regex: ${regex}`
        ];
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

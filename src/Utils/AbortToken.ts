//https://gist.github.com/pygy/6290f78b078e22418821b07d8d63f111#gistcomment-3408351
class AbortToken {
    private readonly abortSymbol = Symbol('cancelled');
    private abortPromise: Promise<any>;
    private resolve!: Function; // Works due to promise init

    constructor() {
        this.abortPromise = new Promise(res => this.resolve = res);
    }

    public async wrap<T>(p: PromiseLike<T>): Promise<T> {
        const result = await Promise.race([p, this.abortPromise]);
        if (result === this.abortSymbol) {
            throw new Error('aborted');
        }

        return result;
    }

    public abort() {
        this.resolve(this.abortSymbol);
    }
}

export default AbortToken;

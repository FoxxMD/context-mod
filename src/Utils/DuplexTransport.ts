import {Stream as StreamTransport} from "winston/lib/winston/transports";
import {Duplex, Transform, TransformOptions} from "stream";
import {TransportStreamOptions} from "winston-transport";

export interface DuplexTransportOptions extends TransportStreamOptions {
    stream?: Duplex | TransformOptions
    eol?: string,
    dump?: boolean,
    name?: string,
}

class DuplexTransport extends StreamTransport {
    duplex: Duplex;
    name?: string;

    constructor(opts?: DuplexTransportOptions) {
        const {stream: optStream, dump = false, name} = opts || {};
        let stream: Transform;
        if (optStream instanceof Transform) {
            stream = optStream;
        } else if (optStream !== undefined) {
            stream = new Transform(optStream as TransformOptions);
        } else {
            stream = new Transform({
                transform(chunk, e, cb) {
                    cb(null, chunk)
                }
            });
        }
        super({...opts, stream});
        this.duplex = stream;
        this.name = name;

        if (dump) {
            // immediately dump data
            this.duplex.on('data', (_) => {
            });
        }
    }

    stream(options = {}) {
        this.duplex.on('data', (chunk) => {
            try {
                if (this.duplex.writableObjectMode) {
                    this.duplex.emit('log', {...chunk, name: this.name});
                } else {
                    const msg = chunk.toString();
                    this.duplex.emit('log', {
                        message: msg,
                        name: this.name,
                        [Symbol.for('message')]: msg,
                    });
                }
            } catch (e) {
                this.duplex.emit('error', e);
            }
        });
        return this.duplex;
    }
}

export default DuplexTransport;

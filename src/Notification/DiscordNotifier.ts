import webhook from 'webhook-discord';
import {NotificationContent} from "../Common/interfaces";

class DiscordNotifier {
    name: string
    type: string = 'Discord';
    url: string;

    constructor(name: string, url: string) {
        this.name = name;
        this.url = url;
    }

    handle(val: NotificationContent) {
        const h = new webhook.Webhook(this.url);

        const hook = new webhook.MessageBuilder();

        const {logLevel, title, footer, body = ''} = val;

        hook.setName('RCB')
            .setTitle(title)
            .setDescription(body)

        if (footer !== undefined) {
            // @ts-ignore
            hook.setFooter(footer, false);
        }

        switch (logLevel) {
            case 'error':
                hook.setColor("##ff0000");
                break;
            case 'warn':
                hook.setColor("#ffe900");
                break;
            default:
                hook.setColor("#00fffa");
                break;
        }

        h.send(hook);
    }
}

export default DiscordNotifier;

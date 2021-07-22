import {addAsync, Router} from '@awaitjs/express';
import express from 'express';
import Snoowrap from "snoowrap";
import {permissions} from "../util";
import {getLogger} from "../Utils/loggerFactory";
import {OperatorConfig} from "../Common/interfaces";

const app = addAsync(express());
const router = Router();
app.set('views', `${__dirname}/views`);
app.set('view engine', 'ejs');

app.use(router);

const helperServer = async function (options: OperatorConfig) {
    let rUri: string;

    const {
        credentials: {
            clientId,
            clientSecret,
            redirectUri
        },
        web: {
            port
        }
    } = options;

    const server = await app.listen(port);
    const logger = getLogger(options);
    logger.info(`Helper UI started: http://localhost:${port}`);
    app.getAsync('/', async (req, res) => {
        res.render('helper', {
            redirectUri
        });
    });

    app.getAsync('/auth', async (req, res) => {
        rUri = req.query.redirect as string;
        let permissionsList = permissions;

        const includeWikiEdit = (req.query.wikiEdit as any).toString() === "1";
        if (!includeWikiEdit) {
            permissionsList = permissionsList.filter(x => x !== 'wikiedit');
        }
        const authUrl = Snoowrap.getAuthUrl({
            clientId,
            scope: permissionsList,
            redirectUri: rUri as string,
            permanent: true,
        });
        return res.redirect(authUrl);
    });

    app.getAsync(/.*callback$/, async (req, res) => {
        const {error, code} = req.query as any;
        if (error !== undefined) {
            let errContent: string;
            switch (error) {
                case 'access_denied':
                    errContent = 'You must <b>Allow</b> this application to connect in order to proceed.';
                    break;
                default:
                    errContent = error;
            }
            return res.render('error', {error: errContent, });
        }
        const client = await Snoowrap.fromAuthCode({
            userAgent: `web:contextBot:web`,
            clientId,
            clientSecret,
            redirectUri: rUri,
            code: code as string,
        });
        // @ts-ignore
        const user = await client.getMe();

        res.render('callback', {
            accessToken: client.accessToken,
            refreshToken: client.refreshToken,
        });
    });
}

export default helperServer;

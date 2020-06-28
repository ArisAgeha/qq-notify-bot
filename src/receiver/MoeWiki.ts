import { App, Meta } from "koishi";
import axios from 'axios';

export class MoeWiki {

    app: App;
    prefixs = ['moe', 'moe ', '萌百', '萌百 '];
    userData = {};

    constructor(app: App) {
        this.app = app;
        this.initMoeWiki();
    }

    private initMoeWiki() {
        const app = this.app;

        this.app.group(435649543).receiver.on('message', (msg) => {
            const text = msg.rawMessage;

            this.prefixs.forEach(word => {
                if (text.toLowerCase().startsWith(word + ' ')) this.startSearch(msg);
            });

            if (/^\d+$/.test(text)) this.getSection(msg);
        })
    }

    private async startSearch(msg: Meta<'message'>) {
        const sender = msg.sender.userId;
        const word = this.getWord(msg.rawMessage);
        const $ = await this.fetchHtml(word, msg);
        if (!$) return;
        const vNode = this.buildVNode($);
        this.saveVNode(msg, vNode);

        const res = vNode.introduction + '\r\n' + vNode.catalog + '\r\n' + vNode.suffix;
        msg.$send(`[CQ:at,qq=${sender}]\r\n${res}`);
    }

    private getSection(msg: Meta<'message'>) {
        const sender = msg.sender.userId;
        if (!this.userData[sender]) return;

        const { vNode, requestTime } = this.userData[sender];
        const now = Date.now();
        if (now - requestTime > 300 * 1000) return;

        const index = Number(msg.rawMessage);
        const section = vNode.section[index];
        msg.$send(`[CQ:at,qq=${sender}]\r\n${section}`);
    }

    private buildVNode($: any): VNode {
        let content = $('.mw-parser-output');
        content = content[1] ? content[1] : content[0];

        const catalog: string[] = this.buildCatalog($);
        const catalogString: string = this.buildCatalogString(catalog);
        const introduction: string = this.buildIntroduction($, content);
        const suffix = '5分钟内，输入词条目录的编号可获取词条内容';
        const section = this.buildSection(content);

        return {
            catalog: catalogString,
            introduction,
            suffix,
            section
        }
    }

    private saveVNode(msg: Meta<'message'>, vNode: VNode) {
        const sender = msg.sender.userId;
        this.userData[sender] = { requestTime: Date.now(), vNode: vNode }
    }

    private buildSection(content: any) {
        const domArray = content.children;
        const sections = [];
        let counter = 0;
        for (let i = 0; i < domArray.length; i++) {
            const item = domArray[i];
            if (item.name === 'h2') {
                counter++;
                sections[counter] = '';
            }
            else if (item.counter === 0) {
                continue;
            }
            else {
                const text = this.recursedTag(item);
                if (text) sections[counter] += text;
            }
        }

        return sections;
    }

    private buildCatalog($: any) {
        const catalog = [];
        const dirHtml = $('#toc .toclevel-1 > a');
        const dirHtmlArray = dirHtml[0] ? Object.values(dirHtml) : [dirHtml];
        dirHtmlArray.forEach((item: any) => {
            if (item?.attribs?.href) catalog.push(item.attribs.href.slice(1));
        });
        return catalog;
    }

    private buildCatalogString(catalog: string[]) {
        let catalogInfo = '词条目录：\r\n'
        catalogInfo += catalog.reduce((prev, cur, cin) => {
            return `${prev}\r\n${cin + 1}：${cur}`;
        }, '');
        return catalogInfo;
    }

    private buildIntroduction($: any, content: any) {
        let introduction = '';
        for (let i = 0; i < content.children.length; i++) {
            const item = content.children[i];
            if (item.name === 'p') {
                if (item.children) {
                    const text: string = this.recursedTag(item);
                    if (text) introduction += text;
                }
            }

            if (item.name === 'h2') break;
        }
        return introduction;
    }

    private recursedTag(item: any): string {
        let intro = '';
        const paraArray = item.children;
        if (!paraArray) return;
        paraArray.forEach(para => {
            if (['style', 'script'].includes(para.type)) return;
            if (para.data && para.data !== '\\n') {
                intro += String(para.data);
            }
            if (para.children) {
                intro += String(this.recursedTag(para));
            }
        });
        return intro;
    }

    private async fetchHtml(word: string, msg: Meta<'message'>) {
        let res;
        try {
            res = await axios.get(encodeURI(`https://zh.moegirl.org/${word}`));
            console.log('fetch success');
            const html = res.data;
            const cheerio = require('cheerio');
            const $ = cheerio.load(html);
            return $;
        }
        catch (err) {
            console.log(err);
        }

    }

    private getWord = (text: string) => {
        let word = '';

        for (let prefixWord of this.prefixs) {
            if (text.toLowerCase().startsWith(word)) {
                const slicePos = prefixWord.length;
                word = text.slice(slicePos);
                break;
            }
        }

        return word;
    }
}

type VNode = {
    catalog: string;
    introduction: string;
    suffix: string;
    section: string[]
}
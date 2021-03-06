import { App, Meta, Sender } from 'koishi';
import axios from 'axios';
import { isArray } from 'util';
const fs = require('fs');
const path = require('path');

export class MoeWiki {

    app: App;
    prefixs = ['moe', 'moe ', '萌百', '萌百 '];
    searchPrefixs = ['moes', 'moes ', '萌百搜索', '萌百搜索 '];
    userData = {};
    searchData = {};
    pictureMaps = {};

    constructor(app: App) {
        this.app = app;
        this.initMoeWiki();
    }

    private async initMoeWiki() {
        const app = this.app;

        this.app.receiver.on('message', (msg) => {
            const text = msg.rawMessage;

            for (const word of this.searchPrefixs) {
                if (text.toLowerCase().startsWith(word)) {
                    this.redirectToSearchPage(msg);
                    return;
                }
            }

            for (const word of this.prefixs) {
                if (text.toLowerCase().startsWith(word)) {
                    this.startSearch(msg);
                    return;
                }
            }

            if (/^\d+$/.test(text)) this.handleNumber(msg);
        })
    }

    private async startSearch(msg: Meta<'message'>) {
        const sender = msg.sender.userId;
        const word = this.getWord(msg.rawMessage);
        const $ = await this.fetchHtml(word, msg);
        if (!$) return;
        const vNode = await this.buildVNode($);
        this.saveVNode(msg, vNode);
        const pictureCq = `[CQ:image,file=${vNode.pictureFilename}]`;
        const targetUrl = encodeURI(`https://zh.moegirl.org.cn/${word.trim()}`);

        const res = vNode.introduction + pictureCq + '\r\n' + vNode.catalog + '\r\n' + vNode.suffix+ '\r\n' + targetUrl;
        await msg.$send(`[CQ:at,qq=${sender}]\r\n${res}`);
        setTimeout(() => {
            fs.unlink(vNode.picturePath, () => { });
        }, 10000);
    }

    private handleNumber(msg: Meta<'message'>) {
        const sender = msg.sender.userId;
        const userData = this.userData[sender];

        if (!userData) return;
        if (userData.vNode) {
            const now = Date.now();
            if (now - userData.requestTime > 120 * 1000) return;
            const index = Number(msg.rawMessage);
            if (index > userData.vNode.section.length) return;
            this.getSection(msg);
        }
        else if (userData.pageTitle) {
            const now = Date.now();
            if (now - userData.requestTime > 30 * 1000) return;
            const index = Number(msg.rawMessage);
            if (index > userData.pageTitle.length) return;
            msg.rawMessage = `moe ${userData.pageTitle[index - 1]}`
            this.startSearch(msg);
        }
    }

    private async getSection(msg: Meta<'message'>) {
        const sd = msg.sender.userId;
        const groupId = msg.groupId;

        const { vNode } = this.userData[sd];

        const index = Number(msg.rawMessage);
        let section = vNode.section[index];

        const newSection = await this.getPictures(section);
        if (newSection) section = newSection;

        const sender = new Sender(this.app);
        for (let i = 0; i < Math.ceil(section.length / 3000); i++) {
            const startIndex = i * 3000;
            const endIndex = (i + 1) * 3000;
            // await msg.$send(`${section.slice(startIndex, endIndex)}`);
            await sender.sendGroupMsg(groupId, `${section.slice(startIndex, endIndex)}`);
            await this.wait(300);
        }
        const images = section.match(/\[CQ:image,file=\d+\]/g);
        await msg.$send(`[CQ:at,qq=${sd}]`);
    }

    private async wait(time) {
        return new Promise((res) => {
            setTimeout(() => {
                res();
            }, time);
        })
    }

    private async getPictures(section) {
        const images = section.match(/\[CQ:image,file=\d+\]/g);
        if (!images) return;
        await Promise.all(
            images.map(async imageCq => {
                const rd = imageCq.match(/\d+/)[0];
                const src = this.pictureMaps[rd];
                if (!src) return;
                const { filename, picturePath } = await this.downloadPicture(src);

                setTimeout(() => {
                    if (fs.existsSync(picturePath)) {
                        fs.unlink(picturePath, () => { })
                    };
                }, 60 * 1000);

                section = section.replace(rd, filename);
            })
        );
        return section;
    }

    private async buildVNode($: any): Promise<VNode> {
        let content = $('.mw-parser-output');
        content = content[1] ? content[1] : content[0];

        const catalog: string[] = this.buildCatalog(content);

        const catalogString: string = this.buildCatalogString(catalog);

        const introduction: string = this.buildIntroduction($, content);

        const pictureSrc: string = this.getPreview($);
        const picture = await this.downloadPicture(pictureSrc);

        const suffix = '【2分钟内，输入词条目录的编号可获取词条内容】';
        const section = this.buildSection(content);

        return {
            catalog: catalogString,
            introduction,
            suffix,
            section,
            pictureFilename: picture.filename,
            picturePath: picture.picturePath
        }
    }

    private getPreview($: any) {
        const imgs = $('table img');
        const src = imgs[0]?.attribs?.src;
        return src;
    }

    async downloadPicture(src: string) {
        const response = await axios({
            method: 'GET',
            url: src,
            responseType: 'stream'
        })

        const rd = String(Math.ceil(Math.random() * 10000000));
        const savePath = path.resolve(`I:\\酷Q Pro\\data\\image\\${rd}`);

        response.data.pipe(fs.createWriteStream(savePath));
        await new Promise((res) => {
            response.data.on('end', () => {
                console.log('request image end');
                res();
            });
            response.data.on('error', (err) => {
                console.log(err);
                res();
            });
        });

        return {
            filename: rd,
            picturePath: savePath
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
                const text = this.recursedTag(item, true);
                if (text) sections[counter] += text;
            }
        }

        return sections;
    }

    private buildCatalog(content: any) {
        const catalog = [];
        const domArray = content.children;
        for (let i = 0; i < domArray.length; i++) {
            const item = domArray[i];
            if (item.name === 'h2') {
                const target = item.children[1] ? item.children[1].attribs.id : item.children[0].attribs.id;
                catalog.push(target);
            }
        }
        return catalog;
    }

    private buildCatalogString(catalog: string[]) {
        let catalogInfo = '词条目录：\r\n'
        catalogInfo += catalog.reduce((prev, cur, cin) => {
            return `${prev}\r\n${cin + 1}. ${cur}`;
        }, '');
        return catalogInfo;
    }

    private buildIntroduction($: any, content: any) {
        let introduction = '';
        for (let i = 0; i < content.children.length; i++) {
            const item = content.children[i];
            if (item.name === 'p') {
                if (item.children) {
                    const text: string = this.recursedTag(item, false);
                    if (text) introduction += text;
                }
            }

            if (item.name === 'h2') break;
        }
        return introduction;
    }

    private recursedTag(item: any, shouldGetImg: boolean): string {
        let intro = '';
        const paraArray = item.children;
        if (!paraArray) return;
        paraArray.forEach(para => {
            if (['style', 'script'].includes(para.type)) return;
            if (para.name === 'table') return;
            if (para.name === 'img' && shouldGetImg) {
                const imgSrc = para.attribs.src;
                const rd = Math.ceil(Math.random() * 100000000);
                this.pictureMaps[rd] = imgSrc;
                intro += `[CQ:image,file=${rd}]`;
            }
            if (para.data && para.data !== '\\n') {
                intro += String(para.data);
            }
            if (para.children) {
                intro += String(this.recursedTag(para, shouldGetImg));
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
            if (err.response.status === 404) {
                this.redirectToSearchPage(msg);
            }
        }
    }

    private async redirectToSearchPage(msg: Meta<'message'>) {
        let res;
        try {
            const word = this.getWord(msg.rawMessage);
            res = await axios.get(encodeURI(`https://zh.moegirl.org/index.php?title=Special:搜索&limit=20&offset=20&profile=default&search=${word}`));
            console.log('redirect success');
            const html = res.data;
            const cheerio = require('cheerio');
            const $ = cheerio.load(html);
            this.parseSearchPage($, msg);
        }
        catch (err) {
            console.log(err);
            msg.$send('服务器炸了，你猜猜是萌百炸了还是我炸了？')
        }
    }

    private parseSearchPage($: any, msg: Meta<'message'>) {
        const sender = msg.sender.userId;
        const contents = $('.mw-search-result-heading > a');
        let contentsArray = isArray(contents) ? contents : Object.values(contents);
        contentsArray = contentsArray.slice(0, 20);
        if (contents.length === 0) {
            msg.$send('Moe上啥都没 Σ(⊙▽⊙"a');
            return;
        }

        const titles = contentsArray.map(item => {
            return item.attribs?.title;
        }).filter(item => item);

        const searchRes = titles.reduce((prev, cur, cin) => {
            return `${prev}\r\n${cin + 1}. ${cur}`;
        }, '');

        this.userData[sender] = {
            requestTime: Date.now(),
            pageTitle: titles
        }

        const prefix = '已搜索到下列条目：';
        const suffix = '【30秒内，输入编号可以查看条目】';

        const res = prefix + '\r\n' + searchRes + '\r\n' + suffix;
        msg.$send(`[CQ:at,qq=${msg.sender.userId}]\r\n${res}`);
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
    section: string[];
    pictureFilename: string;
    picturePath: string;
}
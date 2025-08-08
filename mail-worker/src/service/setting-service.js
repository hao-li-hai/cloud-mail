import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import { settingConst, verifyRecordType } from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import emailService from './email-service';
import accountService from './account-service';
import userService from './user-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n.js'
import verifyRecordService from './verify-record-service';

const settingService = {

    _getKv: (c) => {
        const kv = c.env.kv || (c.bindings && c.bindings.kv);
        if (!kv) {
            throw new Error("KV namespace not found in context. Check wrangler.toml bindings.");
        }
        return kv;
    },

	async refresh(c) {
		const settingRow = await orm(c).select().from(setting).get();
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		await this._getKv(c).put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {
		const settingJson = await this._getKv(c).get(KvConst.SETTING);
        if (!settingJson) {
            const defaultSetting = { resendTokens: '{}' };
            await this._getKv(c).put(KvConst.SETTING, JSON.stringify(defaultSetting));
            return { ...defaultSetting, domainList: []};
        }
        const settingData = JSON.parse(settingJson);

		let domainList = c.env.domain || (c.bindings && c.bindings.domain);
		if (typeof domainList === 'string') {
			domainList = domainList.split(',').map(item => item.trim());
		}
		if (!Array.isArray(domainList)) {
			console.warn('`domain` is not an array, fallback to empty array.');
            domainList = [];
		}

		settingData.domainList = domainList.map(item => '@' + item);
		return settingData;
	},

	async get(c) {
		const [settingRow, recordList] = await Promise.all([
			this.query(c),
			verifyRecordService ? verifyRecordService.selectListByIP(c) : Promise.resolve([])
		]);

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 12)}******` : null;
		Object.keys(settingRow.resendTokens || {}).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		let regVerifyOpen = false
		let addVerifyOpen = false

		if (recordList && recordList.length > 0) {
            recordList.forEach(row => {
                if (row.type === verifyRecordType.REG) {
                    regVerifyOpen = row.count >= settingRow.regVerifyCount
                }
                if (row.type === verifyRecordType.ADD) {
                    addVerifyOpen = row.count >= settingRow.addVerifyCount
                }
            })
        }

		settingRow.regVerifyOpen = regVerifyOpen
		settingRow.addVerifyOpen = addVerifyOpen

		return settingRow;
	},

	async set(c, params) {
		const settingData = await this.query(c);
		let resendTokens = { ...settingData.resendTokens, ...params.resendTokens };
		Object.keys(resendTokens).forEach(domain => {
			if (!resendTokens[domain]) delete resendTokens[domain];
		});
		params.resendTokens = JSON.stringify(resendTokens);
		await orm(c).update(setting).set({ ...params }).returning().get();
		await this.refresh(c);
	},

	async setBackground(c, params) {
		const settingRow = await this.query(c);
		let { background } = params
		if (background && !background.startsWith('http')) {
			const r2Binding = c.env.r2 || (c.bindings && c.bindings.r2);
			if (!r2Binding) {
				throw new BizError(t('noOsUpBack'));
			}
			if (!settingRow.r2Domain) {
				throw new BizError(t('noOsDomainUpBack'));
			}
			const file = fileUtils.base64ToFile(background)
			const arrayBuffer = await file.arrayBuffer();
			background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);
			await r2Service.putObj(c, background, arrayBuffer, {
				contentType: file.type
			});
		}
		if (settingRow.background && settingRow.background !== background) {
			try {
				await r2Service.delete(c, settingRow.background);
			} catch (e) {
				console.error(e)
			}
		}
		await orm(c).update(setting).set({ background }).run();
		await this.refresh(c);
		return background;
	},

	async physicsDeleteAll(c) {
		await emailService.physicsDeleteAll(c);
		await accountService.physicsDeleteAll(c);
		await userService.physicsDeleteAll(c);
	},
    
	async websiteConfig(c) {
		// [关键修改] 使用修复后的 get 函数
		const settingRow = await this.get(c);

		// [关键修改] 硬编码您的单域名给前端
        // 注意：前端 login/index.vue 不再使用这个值了，但其他地方可能需要
		settingRow.domainList = ['@student.pmrb.edu.pl'];
        
		return {
			register: settingRow.register,
			title: settingRow.title,
			manyEmail: settingRow.manyEmail,
			addEmail: settingRow.addEmail,
			autoRefreshTime: settingRow.autoRefreshTime,
			addEmailVerify: settingRow.addEmailVerify,
			registerVerify: settingRow.registerVerify,
			send: settingRow.send,
			r2Domain: settingRow.r2Domain,
			siteKey: settingRow.siteKey,
			background: settingRow.background,
			loginOpacity: settingRow.loginOpacity,
			domainList: settingRow.domainList,
			regKey: settingRow.regKey,
			regVerifyOpen: settingRow.regVerifyOpen,
			addVerifyOpen: settingRow.addVerifyOpen,
			noticeTitle: settingRow.noticeTitle,
			noticeContent: settingRow.noticeContent,
			noticeType: settingRow.noticeType,
			noticeDuration: settingRow.noticeDuration,
			noticePosition: settingRow.noticePosition,
			noticeWidth: settingRow.noticeWidth,
			noticeOffset: settingRow.noticeOffset,
			notice: settingRow.notice,
		};
	}
};

export default settingService;

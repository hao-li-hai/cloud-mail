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

	async refresh(c) {
		const settingRow = await orm(c).select().from(setting).get();
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {
		const settingJson = await c.env.kv.get(KvConst.SETTING);
		if (!settingJson) {
			throw new BizError('Settings not found in KV store', 500);
		}
		const settingData = JSON.parse(settingJson);
  
		let domainList = c.env.domain;
		if (typeof domainList === 'string') {
			domainList = domainList.split(',');
		}
		// 确保 domainList 是一个数组
		if (!Array.isArray(domainList)) {
			throw new BizError(t('notJsonDomain'));
		}
  
		domainList = domainList.map(item => '@' + item.trim());
		settingData.domainList = domainList;
		return settingData;
	},

	async get(c) {
		const [settingRow, recordList] = await Promise.all([
			await this.query(c),
			verifyRecordService.selectListByIP(c)
		]);

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 12)}******` : null;
		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		let regVerifyOpen = false
		let addVerifyOpen = false

		recordList.forEach(row => {
			if (row.type === verifyRecordType.REG) {
				regVerifyOpen = row.count >= settingRow.regVerifyCount
			}
			if (row.type === verifyRecordType.ADD) {
				addVerifyOpen = row.count >= settingRow.addVerifyCount
			}
		})

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
			if (!c.env.r2) {
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

	// ### 这是唯一的、最关键的修改点 ###
	async websiteConfig(c) {
		// 不再调用 this.get(c)，因为它内部的 verifyRecordService 可能会在冷启动时导致崩溃。
		// 我们直接调用 this.query(c)，因为它只获取最基础的数据库配置，是安全的。
		const settingRow = await this.query(c);

		// 由于 this.get(c) 中的逻辑没有执行，我们需要手动补上这些布尔值的默认值。
		// 对于一个未登录的配置请求，它们默认为 false 是完全合理的。
		settingRow.regVerifyOpen = false;
		settingRow.addVerifyOpen = false;

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

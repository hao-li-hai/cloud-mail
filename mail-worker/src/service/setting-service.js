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
    _getBinding: (c, bindingName) => {
        const binding = c.env[bindingName] || (c.bindings && c.bindings[bindingName]);
        if (!binding) {
            console.error(`[FATAL] Binding '${bindingName}' not found.`);
            // 生产环境中，最好有一个优雅的降级，而不是让所有请求都失败
            if (bindingName === 'kv') return null;
            if (bindingName === 'domain') return [];
        }
        return binding;
    },

    async refresh(c) {
        try {
            const settingRow = await orm(c).select().from(setting).get();
            if(settingRow) {
                settingRow.resendTokens = JSON.parse(settingRow.resendTokens || '{}');
                const kv = this._getBinding(c, 'kv');
                if (kv) {
                    await kv.put(KvConst.SETTING, JSON.stringify(settingRow));
                }
            }
        } catch (e) {
            console.error("Error refreshing settings:", e);
        }
    },

    async query(c) {
        let settingData;
        const kv = this._getBinding(c, 'kv');
        
        if (kv) {
            const settingJson = await kv.get(KvConst.SETTING, { type: 'json' }).catch(() => null);
             if (settingJson) {
                settingData = settingJson;
            }
        }

        if (!settingData) {
            console.warn("Settings not found in KV, fetching from DB or using defaults.");
            const dbSetting = await orm(c).select().from(setting).get().catch(() => null);
            if (dbSetting) {
                settingData = dbSetting;
                settingData.resendTokens = JSON.parse(settingData.resendTokens || '{}');
            } else {
                settingData = { resendTokens: {} }; // 使用一个最小化的默认对象
            }
            if (kv) {
                await kv.put(KvConst.SETTING, JSON.stringify(settingData));
            }
        }

        // 硬编码单域名，不再依赖环境配置
        settingData.domainList = ['@student.pmrb.edu.pl'];
        
        return settingData;
    },

    async get(c) {
        const [settingRow, recordList] = await Promise.all([
            this.query(c),
            verifyRecordService ? verifyRecordService.selectListByIP(c) : Promise.resolve([])
        ]);

        settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 12)}******` : null;
        Object.keys(settingRow.resendTokens || {}).forEach(key => {
            const token = settingRow.resendTokens[key];
             if(typeof token === 'string' && token.length > 12) {
                settingRow.resendTokens[key] = `${token.slice(0, 12)}******`;
            }
        });

        let regVerifyOpen = false, addVerifyOpen = false;
        
        if (Array.isArray(recordList)) {
            recordList.forEach(row => {
                if (row.type === verifyRecordType.REG) {
                    regVerifyOpen = row.count >= settingRow.regVerifyCount;
                }
                if (row.type === verifyRecordType.ADD) {
                    addVerifyOpen = row.count >= settingRow.addVerifyCount;
                }
            });
        }

        settingRow.regVerifyOpen = regVerifyOpen;
        settingRow.addVerifyOpen = addVerifyOpen;

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
        let { background } = params;

        if (background && !background.startsWith('http')) {
            const r2Binding = this._getBinding(c, 'r2');
            if (!r2Binding) throw new BizError(t('noOsUpBack'));
            if (!settingRow.r2Domain) throw new BizError(t('noOsDomainUpBack'));

            const file = fileUtils.base64ToFile(background);
            const arrayBuffer = await file.arrayBuffer();
            background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);
            await r2Service.putObj(c, background, arrayBuffer, { contentType: file.type });
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
        const settingRow = await this.get(c);
        // 确保返回的 domainList 为空，因为前端不需要它了
        settingRow.domainList = []; 
        return settingRow;
    }
};
export default settingService;

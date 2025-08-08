import BizError from '../error/biz-error';
import userService from './user-service';
import emailUtils from '../utils/email-utils';
import { isDel, settingConst, userConst } from '../const/entity-const';
import JwtUtils from '../utils/jwt-utils';
import { v4 as uuidv4 } from 'uuid';
import KvConst from '../const/kv-const';
import constant from '../const/constant';
import userContext from '../security/user-context';
import verifyUtils from '../utils/verify-utils';
import accountService from './account-service';
import settingService from './setting-service';
import saltHashUtils from '../utils/crypto-utils';
import cryptoUtils from '../utils/crypto-utils';
import turnstileService from './turnstile-service';
import roleService from './role-service';
import regKeyService from './reg-key-service';
import dayjs from 'dayjs';
import { toUtc } from '../utils/date-uitil';
import { t } from '../i18n/i18n.js';
import verifyRecordService from './verify-record-service';

const loginService = {

	// [修改点] register 函数恢复为原始状态，处理前端拼接好的完整邮箱
	async register(c, params) {
		const { email, password, token, code } = params;

		const {regKey, register, registerVerify, regVerifyCount} = await settingService.query(c)

		if (register === settingConst.register.CLOSE) {
			throw new BizError(t('regDisabled'));
		}

		if (!verifyUtils.isEmail(email)) {
			throw new BizError(t('notEmail'));
		}

		if (password.length > 30) {
			throw new BizError(t('pwdLengthLimit'));
		}

		if (emailUtils.getName(email).length > 30) {
			throw new BizError(t('emailLengthLimit'));
		}

		if (password.length < 6) {
			throw new BizError(t('pwdMinLengthLimit'));
		}

		if (!c.env.domain.includes(emailUtils.getDomain(email))) {
			throw new BizError(t('notEmailDomain'));
		}

		let type = null;
		let regKeyId = 0

		if (regKey === settingConst.regKey.OPEN) {
			const result = await this.handleOpenRegKey(c, regKey, code)
			type = result?.type
			regKeyId = result?.regKeyId
		}

		if (regKey === settingConst.regKey.OPTIONAL) {
			const result = await this.handleOpenOptional(c, regKey, code)
			type = result?.type
			regKeyId = result?.regKeyId
		}

		const accountRow = await accountService.selectByEmailIncludeDel(c, email);

		if (accountRow && accountRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelUser'));
		}

		if (accountRow) {
			throw new BizError(t('isRegAccount'));
		}

		let defType = null

		if (!type) {
			const roleRow = await roleService.selectDefaultRole(c);
			defType = roleRow.roleId
		}

		const roleRow = await roleService.selectById(c, type || defType);

		if(!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {
			if (type) {
				throw new BizError(t('noDomainPermRegKey'),403)
			}
			if (defType) {
				throw new BizError(t('noDomainPermReg'),403)
			}
		}

		let regVerifyOpen = false

		if (registerVerify === settingConst.registerVerify.OPEN) {
			regVerifyOpen = true
			await turnstileService.verify(c,token)
		}

		if (registerVerify === settingConst.registerVerify.COUNT) {
			regVerifyOpen = await verifyRecordService.isOpenRegVerify(c, regVerifyCount);
			if (regVerifyOpen) {
				await turnstileService.verify(c,token)
			}
		}

		const { salt, hash } = await saltHashUtils.hashPassword(password);

		const userId = await userService.insert(c, { email, regKeyId,password: hash, salt, type: type || defType });

		await userService.updateUserInfo(c, userId, true);

		await accountService.insert(c, { userId: userId, email, name: emailUtils.getName(email) });

		if (regKey !== settingConst.regKey.CLOSE && type) {
			await regKeyService.reduceCount(c, code, 1);
		}

		if (registerVerify === settingConst.registerVerify.COUNT && !regVerifyOpen) {
			const row = await verifyRecordService.increaseRegCount(c);
			return {regVerifyOpen: row.count >= regVerifyCount}
		}

		return {regVerifyOpen}
	},

	async handleOpenRegKey(c, regKey, code) {
		if (!code) throw new BizError(t('emptyRegKey'));
		const regKeyRow = await regKeyService.selectByCode(c, code);
		if (!regKeyRow) throw new BizError(t('notExistRegKey'));
		if (regKeyRow.count <= 0) throw new BizError(t('noRegKeyCount'));
		const today = toUtc().tz('Asia/Shanghai').startOf('day')
		const expireTime = toUtc(regKeyRow.expireTime).tz('Asia/Shanghai').startOf('day');
		if (expireTime.isBefore(today)) throw new BizError(t('regKeyExpire'));
		return { type: regKeyRow.roleId, regKeyId: regKeyRow.regKeyId };
	},

	async handleOpenOptional(c, regKey, code) {
		if (!code) return null
		const regKeyRow = await regKeyService.selectByCode(c, code);
		if (!regKeyRow) return null
		const today = toUtc().tz('Asia/Shanghai').startOf('day')
		const expireTime = toUtc(regKeyRow.expireTime).tz('Asia/Shanghai').startOf('day');
		if (regKeyRow.count <= 0 || expireTime.isBefore(today)) return null
		return { type: regKeyRow.roleId, regKeyId: regKeyRow.regKeyId };
	},

	// [修改点] login 函数被重写，以支持多域名遍历登录
	async login(c, params) {
		const { email, password } = params; // email 此时是前缀
	
		if (!email || !password) {
			throw new BizError(t('emailAndPwdEmpty'));
		}
	
		// 从环境配置中获取所有可用域名
		const allowedDomains = c.env.domain;
		if (!allowedDomains || !Array.isArray(allowedDomains) || allowedDomains.length === 0) {
			throw new BizError('系统未配置可用域名');
		}
	
		let userRow = null;
		let isAuthenticated = false;
	
		// 遍历所有域名进行尝试
		for (const domain of allowedDomains) {
			const fullEmail = email + domain; // 构造完整的邮箱地址
	
			const potentialUser = await userService.selectByEmailIncludeDel(c, fullEmail);
			
			// 如果找到了用户，就尝试验证密码
			if (potentialUser) {
				if (await cryptoUtils.verifyPassword(password, potentialUser.salt, potentialUser.password)) {
					// 密码正确，确认用户，停止遍历
					userRow = potentialUser;
					isAuthenticated = true;
					break; 
				}
			}
		}
	
		// 循环结束后，检查是否认证成功
		if (!isAuthenticated || !userRow) {
			throw new BizError(t('IncorrectPwd')); // 提示通用错误，不要暴露用户是否存在
		}
	
		// --- 后续逻辑和原来保持一致 ---
		if(userRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelUser'));
		}
	
		if(userRow.status === userConst.status.BAN) {
			throw new BizError(t('isBanUser'));
		}
	
		const uuid = uuidv4();
		const jwt = await JwtUtils.generateToken(c,{ userId: userRow.userId, token: uuid });
	
		let authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userRow.userId, { type: 'json' });
	
		if (authInfo) {
			if (authInfo.tokens.length > 10) {
				authInfo.tokens.shift();
			}
			authInfo.tokens.push(uuid);
		} else {
			authInfo = {
				tokens: [],
				user: userRow,
				refreshTime: dayjs().toISOString()
			};
			authInfo.tokens.push(uuid);
		}
	
		await userService.updateUserInfo(c, userRow.userId);
	
		await c.env.kv.put(KvConst.AUTH_INFO + userRow.userId, JSON.stringify(authInfo), { expirationTtl: constant.TOKEN_EXPIRE });
		return jwt;
	},

	async logout(c, userId) {
		const token =userContext.getToken(c);
		const authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userId, { type: 'json' });
		const index = authInfo.tokens.findIndex(item => item === token);
		authInfo.tokens.splice(index, 1);
		await c.env.kv.put(KvConst.AUTH_INFO + userId, JSON.stringify(authInfo));
	}

};

export default loginService;

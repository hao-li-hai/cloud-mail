<template>
  <div id="login-box">
    <div id="background-wrap" v-if="!settingStore.settings.background">
      <div class="x1 cloud"></div>
      <div class="x2 cloud"></div>
      <div class="x3 cloud"></div>
      <div class="x4 cloud"></div>
      <div class="x5 cloud"></div>
    </div>
    <div v-else :style="background"></div>
    <div class="form-wrapper">
        <div class="container">
          <span class="form-title">{{settingStore.settings.title}}</span>
          <span class="form-desc" v-if="show === 'login'">{{$t('loginTitle')}}</span>
          <span class="form-desc" v-else>{{$t('regTitle')}}</span>
          
          <!-- 登录表单 (无域名后缀) -->
          <div v-show="show === 'login'">
            <el-input class="email-input" v-model="form.email" type="text" :placeholder="$t('emailAccount')" autocomplete="off" />
            <el-input v-model="form.password" :placeholder="$t('password')" type="password" autocomplete="off" />
            <el-button class="btn" type="primary" @click="submit" :loading="loginLoading">{{$t('loginBtn')}}</el-button>
          </div>
          
          <!-- 注册表单 (无域名后缀) -->
          <div v-show="show !== 'login'">
            <el-input class="email-input" v-model="registerForm.email" type="text" :placeholder="$t('emailAccount')" autocomplete="off" />
            <el-input v-model="registerForm.password" :placeholder="$t('password')" type="password" autocomplete="off" />
            <el-input v-model="registerForm.confirmPassword" :placeholder="$t('confirmPwd')" type="password" autocomplete="off" />
            <el-input v-if="settingStore.settings.regKey === 0" v-model="registerForm.code" :placeholder="$t('regKey')" type="text" autocomplete="off" />
            <el-input v-if="settingStore.settings.regKey === 2" v-model="registerForm.code" :placeholder="$t('regKeyOptional')" type="text" autocomplete="off" />
            <div v-show="verifyShow"
                class="register-turnstile"
                :data-sitekey="settingStore.settings.siteKey"
                data-callback="onTurnstileSuccess"
                data-error-callback="onTurnstileError"
            >
              <span style="font-size: 12px;color: #F56C6C" v-if="botJsError">{{$t('verifyModuleFailed')}}</span>
            </div>
            <el-button class="btn" type="primary" @click="submitRegister" :loading="registerLoading">{{$t('regBtn')}}</el-button>
          </div>
          
          <template v-if="settingStore.settings.register === 0">
            <div class="switch" @click="show = (show === 'login' ? 'register' : 'login')" v-if="show === 'login'">{{$t('noAccount')}} <span>{{$t('regSwitch')}}</span></div>
            <div class="switch" @click="show = (show === 'login' ? 'register' : 'login')" v-else>{{$t('hasAccount')}} <span>{{$t('loginSwitch')}}</span></div>
          </template>
        </div>
    </div>
  </div>
</template>

<script setup>
import router from "@/router";
import {computed, nextTick, reactive, ref} from "vue";
import {login} from "@/request/login.js";
import {register} from "@/request/login.js";
// [关键修改] 不再需要 isEmail 验证
// import {isEmail} from "@/utils/verify-utils.js";
import {useSettingStore} from "@/store/setting.js";
import {useAccountStore} from "@/store/account.js";
import {useUserStore} from "@/store/user.js";
import {useUiStore} from "@/store/ui.js";
// [关键修改] 不再需要 Icon
// import {Icon} from "@iconify/vue";
import {cvtR2Url} from "@/utils/convert.js";
import {loginUserInfo} from "@/request/my.js";
import {permsToRouter} from "@/perm/perm.js";
import {useI18n} from "vue-i18n";

const { t } = useI18n();
const accountStore = useAccountStore();
const userStore = useUserStore();
const uiStore = useUiStore();
const settingStore = useSettingStore();
const loginLoading = ref(false)
const show = ref('login')
const form = reactive({
  email: '',
  password: '',
});
// [关键修改] 删除了所有和 mySelect, suffix, domainList 相关的变量
const registerForm = reactive({
  email: '',
  password: '',
  confirmPassword: '',
  code: null
})
const registerLoading = ref(false)
const verifyShow = ref(false)
let verifyToken = ''
let turnstileId = null
let botJsError = ref(false)

window.onTurnstileSuccess = (token) => {
  verifyToken = token;
};

window.onTurnstileError = (e) => {
  console.log('人机验加载失败')
  nextTick(() => {
    if (!turnstileId) {
      turnstileId = window.turnstile.render('.register-turnstile')
    } else {
      window.turnstile.reset(turnstileId);
    }
  })
};

const background = computed(() => {
  return settingStore.settings.background ? {
    'background-image': `url(${cvtR2Url(settingStore.settings.background)})`,
    'background-repeat': 'no-repeat',
    'background-size': 'cover',
    'background-position': 'center'
  } : ''
})

const submit = () => {
    if (!form.email) {
        ElMessage({ message: t('emptyEmailMsg'), type: 'error', plain: true });
        return;
    }
    // [关键修改] 移除了 isEmail 验证
    if (!form.password) {
        ElMessage({ message: t('emptyPwdMsg'), type: 'error', plain: true });
        return;
    }
    loginLoading.value = true
    // [关键修改] 不再拼接 suffix，只发送前缀
    login(form.email, form.password).then(async data => {
        localStorage.setItem('token', data.token);
        const user = await loginUserInfo();
        accountStore.currentAccountId = user.accountId;
        userStore.user = user;
        const routers = permsToRouter(user.permKeys);
        routers.forEach(routerData => {
            router.addRoute('layout', routerData);
        });
        await router.replace({ name: 'layout' });
        uiStore.showNotice();
    }).finally(() => {
        loginLoading.value = false;
    });
}

function submitRegister() {
    if (!registerForm.email) {
        ElMessage({ message: t('emptyEmailMsg'), type: 'error', plain: true });
        return;
    }
    // [关键修改] 移除了 isEmail 验证
    if (!registerForm.password) {
        ElMessage({ message: t('emptyPwdMsg'), type: 'error', plain: true });
        return;
    }
    if (registerForm.password.length < 6) {
        ElMessage({ message: t('pwdLengthMsg'), type: 'error', plain: true, });
        return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
        ElMessage({ message: t('confirmPwdFailMsg'), type: 'error', plain: true, });
        return;
    }
    if(settingStore.settings.regKey === 0) {
        if (!registerForm.code) {
            ElMessage({ message: t('emptyRegKeyMsg'), type: 'error', plain: true, });
            return;
        }
    }
    if (!verifyToken && (settingStore.settings.registerVerify === 0 || (settingStore.settings.registerVerify === 2 && settingStore.settings.regVerifyOpen))) {
        if (!verifyShow.value) {
            verifyShow.value = true
            nextTick(() => {
                if (!turnstileId) {
                    try {
                        turnstileId = window.turnstile.render('.register-turnstile')
                    } catch(e) {
                        botJsError.value = true;
                    }
                } else {
                    window.turnstile.reset('.register-turnstile')
                }
            });
        } else if (!botJsError.value) {
            ElMessage({ message: t('botVerifyMsg'), type: "error", plain: true, });
        }
        return;
    }

    registerLoading.value = true
    
    // [关键修改] 直接传递 registerForm，后端会处理前缀
    const finalRegForm = { 
        email: registerForm.email, 
        password: registerForm.password, 
        token: verifyToken, 
        code: registerForm.code 
    };

    register(finalRegForm).then(({regVerifyOpen}) => {
        show.value = 'login';
        Object.keys(registerForm).forEach(key => registerForm[key] = null);
        registerForm.password = ''; // ensure password fields are cleared
        registerForm.confirmPassword = '';
        registerLoading.value = false;
        verifyToken = '';
        settingStore.settings.regVerifyOpen = regVerifyOpen;
        verifyShow.value = false;
        ElMessage({ message: t('regSuccessMsg'), type: 'success', plain: true, });
    }).catch(res => {
        registerLoading.value = false;
        if (res.code === 400) {
            verifyToken = '';
            settingStore.settings.regVerifyOpen = true;
            if (turnstileId) {
                window.turnstile.reset(turnstileId);
            } else {
                nextTick(() => { turnstileId = window.turnstile.render('.register-turnstile'); });
            }
            verifyShow.value = true;
        }
    });
}
</script>

<style lang="scss" scoped>
// [关键修改] 确保所有输入框都是完整圆角
.container :deep(.el-input__wrapper) {
  border-radius: 6px !important;
}

/* 其他原始样式，为保证完整性，我直接复制进来 */
.form-wrapper{position:fixed;right:0;height:100%;z-index:10;display:flex;align-items:center;justify-content:center;@media (max-width:767px){width:100%}}.container{background:v-bind(loginOpacity);padding-left:40px;padding-right:40px;display:flex;flex-direction:column;justify-content:center;width:450px;height:100%;border:1px solid #e4e7ed;box-shadow:var(--el-box-shadow-light);@media (max-width:1024px){padding:20px 18px;width:384px;margin-left:18px}@media (max-width:767px){padding:20px 18px;border-radius:6px;height:fit-content;width:100%;margin-right:18px;margin-left:18px}.btn{height:36px;width:100%;border-radius:6px}.form-desc{margin-top:5px;margin-bottom:18px;color:#71717a}.form-title{font-weight:bold;font-size:22px!important}.switch{margin-top:20px;text-align:center;span{color:#006be6;cursor:pointer}}.el-input{height:38px;width:100%;margin-bottom:18px;:deep(.el-input__inner){height:36px}}}.register-turnstile{margin-bottom:18px}#login-box{background:linear-gradient(to bottom,#2980b9,#6dd5fa,#fff);color:#333;font:100% Arial,sans-serif;height:100%;margin:0;padding:0;overflow-x:hidden;display:grid;grid-template-columns:1fr}#background-wrap{height:100%;z-index:0}@keyframes animateCloud-c83626c4{0%{margin-left:-500px}to{margin-left:100%}}.x1{animation:animateCloud-c83626c4 30s linear infinite;transform:scale(.65)}.x2{animation:animateCloud-c83626c4 15s linear infinite;transform:scale(.3)}.x3{animation:animateCloud-c83626c4 25s linear infinite;transform:scale(.5)}.x4{animation:animateCloud-c83626c4 13s linear infinite;transform:scale(.4)}.x5{animation:animateCloud-c83626c4 20s linear infinite;transform:scale(.55)}.cloud{background:linear-gradient(to bottom,#fff 5%,#f1f1f1);border-radius:100px;box-shadow:0 8px 5px rgba(0,0,0,.1);height:120px;width:350px;position:relative}.cloud:after,.cloud:before{content:"";position:absolute;background:#fff;z-index:-1}.cloud:after{border-radius:100px;height:100px;left:50px;top:-50px;width:100px}.cloud:before{border-radius:200px;height:180px;width:180px;right:50px;top:-90px}
</style>

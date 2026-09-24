<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth'
import { isMockMode } from '../../api/mode'
import { useFieldValidation, textField } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()
const auth = useAuthStore()
const nickname = ref(auth.session?.user?.nickname || '')
const email = ref(auth.session?.user?.email || '')
const busy = ref(false)
const error = ref('')
const saved = ref(false)
async function save() {
  if (isMockMode || busy.value) return
  if (!validateFields()) return
  busy.value = true; error.value = ''; saved.value = false
  try {
    const body: { nickname?: string; email?: string } = {}
    if (nickname.value !== (auth.session?.user?.nickname || '')) body.nickname = nickname.value.trim()
    if (email.value !== (auth.session?.user?.email || '')) body.email = email.value.trim()
    if (!Object.keys(body).length) return
    await auth.updateProfile(body)
    saved.value = true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
</script>
<template>
  <section class="panel profile-form">
    <h1>个人资料</h1>
    <p v-if="isMockMode">Mock 演示账户不是真实身份，不读取或修改真实资料。</p>
    <template v-else>
      <p>用户名：{{ auth.session?.user?.username }} · 角色：{{ auth.session?.role?.name }}</p>
      <p>仅修改自己的昵称与邮箱，不改变角色或权限。已设置的字段不可清空。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="saved" role="status">资料已保存</p>
      <form novalidate @submit.prevent="save">
        <label v-field="textField(nickname, '昵称', 100, !auth.session?.user?.nickname)">昵称<input v-model="nickname" name="nickname" autocomplete="nickname" maxlength="100"></label>
        <label v-field="email ? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : '请输入有效邮箱') : auth.session?.user?.email ? '邮箱不可清空' : undefined">邮箱<input v-model="email" name="email" type="email" autocomplete="email" maxlength="254"></label>
        <button type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存资料' }}</button>
      </form>
    </template>
  </section>
</template>
<style scoped>
.profile-form { max-width: 600px; padding: 24px; }
form, label { display: grid; gap: 12px; }
input { padding: 10px; border: 1px solid #ccc; border-radius: 6px; }
</style>

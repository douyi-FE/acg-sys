<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { serverRequest } from '../../api/session'
const data = ref<unknown>()
const error = ref('')
const busy = ref(false)
async function load() {
  busy.value = true; error.value = ''
  try { data.value = await serverRequest('/public') }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '公开内容读取失败' }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <section class="panel public-page">
    <h1>公开内容</h1>
    <p>仅展示后端允许公开的数据。登录后按账户权限进入生产空间。</p>
    <router-link to="/login">登录</router-link>
    <a-button :loading="busy" @click="load">刷新公开内容</a-button>
    <a-alert v-if="error" type="error" :message="error" />
    <pre v-if="data">{{ JSON.stringify(data, null, 2) }}</pre>
  </section>
</template>
<style scoped>
.public-page { max-width:1000px; margin:32px auto; } pre { white-space:pre-wrap; overflow-wrap:anywhere; }
</style>

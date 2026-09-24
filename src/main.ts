import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Skeleton,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './styles.css'
import './overrides.css'
import App from './App.vue'
import router from './router'
const app = createApp(App)
app.use(createPinia()).use(router)
for (const component of [
  Alert,
  Button,
  Checkbox,
  Collapse,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Skeleton,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
])
  app.use(component)
app.mount('#app')
// A rejected initial navigation must not leave the DOM blank. The unavailable
// route is intentionally read-only and does not create a session or mock data.
void router.isReady().catch(() => router.replace('/unavailable'))

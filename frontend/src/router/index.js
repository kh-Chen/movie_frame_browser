import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Browse from '../views/Browse.vue'
import MovieDetail from '../views/MovieDetail.vue'
import Gallery from '../views/Gallery.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: Home
  },
  {
    path: '/browse/:id',
    name: 'browse',
    component: Browse,
    props: true
  },
  {
    path: '/gallery/:id',
    name: 'gallery',
    component: Gallery,
    props: true
  },
  {
    path: '/movie/:id',
    name: 'movie-detail',
    component: MovieDetail,
    props: true
  }
]

const router = createRouter({
  history: createWebHistory('/movie/'),
  routes
})

export default router
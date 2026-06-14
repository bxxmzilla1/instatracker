import { isSupabaseConfigured } from '../supabase';
import * as local from './dbLocal';
import * as remote from './dbSupabase';

const impl = isSupabaseConfigured ? remote : local;

export const {
  getEmployees,
  addEmployee,
  deleteEmployee,
  getProxies,
  addProxy,
  deleteProxy,
  getBios,
  addBio,
  deleteBio,
  getCtas,
  addCta,
  deleteCta,
  getBanners,
  addBanner,
  deleteBanner,
  getProfilePics,
  addProfilePic,
  deleteProfilePic,
  getPosts,
  addPost,
  deletePost,
  getBskyAccounts,
  addBskyAccount,
  deleteBskyAccount,
  getSavedAccounts,
  addSavedAccount,
  deleteSavedAccount,
  getTargets,
  addTarget,
  deleteTarget,
} = impl;

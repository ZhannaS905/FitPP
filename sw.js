{\rtf1\ansi\ansicpg1252\cocoartf2907
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fnil\fcharset0 .AppleSystemUIFontMonospaced-Regular;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx560\tx1120\tx1680\tx2240\tx2800\tx3360\tx3920\tx4480\tx5040\tx5600\tx6160\tx6720\pardirnatural\partightenfactor0

\f0\fs22 \cf0 const CACHE_NAME = 'fitpp-cache-v1';\
const ASSETS = [\
  '/',\
  '/index.html',\
  '/manifest.json',\
  '/icon-192.png',\
  '/icon-512.png'\
];\
\
// \uc0\u1059 \u1089 \u1090 \u1072 \u1085 \u1086 \u1074 \u1082 \u1072  Service Worker \u1080  \u1082 \u1101 \u1096 \u1080 \u1088 \u1086 \u1074 \u1072 \u1085 \u1080 \u1077  \u1092 \u1072 \u1081 \u1083 \u1086 \u1074 \
self.addEventListener('install', (event) => \{\
  event.waitUntil(\
    caches.open(CACHE_NAME)\
      .then((cache) => cache.addAll(ASSETS))\
  );\
\});\
\
// \uc0\u1055 \u1077 \u1088 \u1077 \u1093 \u1074 \u1072 \u1090  \u1079 \u1072 \u1087 \u1088 \u1086 \u1089 \u1086 \u1074  \u1080  \u1088 \u1072 \u1073 \u1086 \u1090 \u1072  \u1074  \u1086 \u1092 \u1092 \u1083 \u1072 \u1081 \u1085 \u1077 \
self.addEventListener('fetch', (event) => \{\
  event.respondWith(\
    caches.match(event.request)\
      .then((response) => response || fetch(event.request))\
  );\
\});}
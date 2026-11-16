import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

/* ======================= CONFIG ======================= */
const API_URL = "https://ownwhatsapp-backend-django.onrender.com/api/login/";
const LOGO_URL = "../../allLogo.png"; // public/allLogo.png (ya apna path)
const SITE_TEXT = "https://wbbox.infrainfotech.com"; // marquee text change kar lena
const TIMEOUT = 30000;
const MAX_RETRIES = 1;

/* ======================= STYLES ======================= */
const STYLES = `
.ol, .ol *, .ol *::before, .ol *::after { box-sizing: border-box; }
.ol {
  --gap-radius: 60px;
  --center-radius: 125px;
  --ring1-radius: calc(var(--center-radius) + 1 * var(--gap-radius));
  --ring2-radius: calc(var(--center-radius) + 2 * var(--gap-radius));
  --ring3-radius: calc(var(--center-radius) + 3 * var(--gap-radius));
  font-family: 'Inter', sans-serif;
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.5;
  color: #576071;
  min-height: 100vh;
  overflow-x: hidden;
  background:
    radial-gradient(at 10% 90%, rgba(55, 65, 81, 0.4), transparent),
    linear-gradient(206deg, #326ea0 0%, #3fc5aa 41%, #2eff95 68%);
  background-repeat: no-repeat;
  background-attachment: fixed;
}
@media (min-width: 992px) { .ol { padding: 1.5rem; } }

.ol .ol-wrap { display: flex; align-items: center; position: relative; min-height: 100vh; width: 100%; }

.ol .ol-left { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; padding: 0 1rem; min-height: 100vh; }
@media (min-width: 992px) { .ol .ol-left { flex: none; width: 50%; } }

.ol .ol-card {
  position: relative; display: flex; flex-direction: column; min-width: 0;
  width: 100%; max-width: 560px; padding: 0 1rem;
  background: #fff; border: 1px solid #e3e9ef; border-radius: .9rem;
  box-shadow: rgba(0, 0, 0, 0.35) 0px 5px 15px;
}
@media (min-width: 992px) { .ol .ol-card { width: 75%; } }
.ol .ol-card-body { padding: 3rem 0; }

.ol marquee { display: block; text-shadow: 1px 1px #9571ee; }
.ol marquee h5 { margin: 0 0 5px; font-size: 1.25rem; font-weight: 600; line-height: 1.3; color: #121519; }

.ol .ol-form { width: 100%; margin: 0 auto; padding: 0 1.5rem; }
.ol h3 { margin: 0 0 .25rem; font-size: 1.75rem; font-weight: 600; line-height: 1.3; color: #121519; font-family: 'Inter'; }
.ol .ol-sub { margin: 0 0 1rem; padding-bottom: .5rem; font-size: .875rem; }
@media (min-width: 992px) { .ol .ol-sub { margin-bottom: .5rem; } }
.ol a { color: #448c74; text-decoration: underline; }
.ol a:hover { color: #37715d; text-decoration: none; }

.ol .ol-group { padding-bottom: 1rem; margin-bottom: 1rem; }
.ol .ol-group-pass { margin-bottom: 1.5rem; }
.ol .ol-rel { position: relative; }
.ol .ol-ico {
  position: absolute; top: 50%; left: 0; transform: translateY(-50%);
  margin-left: 1rem; font-size: 1.125rem; color: #858c97; pointer-events: none; z-index: 2;
}

.ol .form-control {
  display: block; width: 100%; padding: .825rem 1rem .825rem 3rem;
  font-family: inherit; font-size: .875rem; font-weight: 400; line-height: 1.4;
  color: #576071; background-color: transparent; background-clip: padding-box;
  border: 1px solid #d7dde2; border-radius: .4rem;
  -webkit-appearance: none; appearance: none; outline: 0; box-shadow: none;
  transition: border-color .15s ease-in-out; margin: 0;
}
.ol .form-control:focus { border-color: #576071; outline: 0; box-shadow: none; }
.ol .form-control.has-err { border-color: #ed5050; }
.ol .form-control::placeholder { color: #b4bbc3; opacity: 1; }
.ol .form-control:disabled { opacity: .7; cursor: not-allowed; }
.ol .form-control-sm {
  min-height: calc(1.4em + 1.15rem + 2px); padding: .575rem .875rem;
  font-size: .75rem; border-radius: .3rem;
}
.ol .ol-err { color: #ed5050; font-size: .75rem; margin-top: .25rem; }

.ol .password-toggle { position: relative; }
.ol .password-toggle .form-control { padding-right: 3rem; }
.ol .password-toggle-btn {
  position: absolute; top: 50%; right: .625rem; padding: .5rem; margin: 0;
  font-size: 1rem; line-height: 1; cursor: pointer; transform: translateY(-50%); display: inline-block;
}
.ol .password-toggle-btn .password-toggle-indicator { font-size: 1.25em; color: #858c97; transition: color .2s ease-in-out; }
.ol .password-toggle-btn .password-toggle-indicator::before {
  display: block; width: 1em; height: 1em; content: ""; background-color: currentcolor;
  -webkit-mask: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3e%3cpath d='M30.267 15.6v-.133c0-.133-.133-.267-.133-.4-.133-.267-.267-.8-.533-1.333-.533-1.067-1.333-2.4-2.533-3.867-2.267-2.8-5.867-5.733-10.933-5.733s-8.8 3.067-11.067 5.867c-1.067 1.333-2 2.8-2.533 3.867-.267.533-.4.933-.533 1.333-.133.133-.133.267-.133.4v.133a.406.406 0 0 0 0 .533v.133c0 .133 0 .267.133.4s.267.8.533 1.333S3.602 20.666 4.802 22c2.133 2.8 5.733 5.733 11.467 5.733S25.602 24.8 27.736 22c1.067-1.467 1.733-2.8 2.267-3.867.267-.533.4-.933.533-1.333 0-.133.133-.267.133-.4v-.133c-.267-.267-.267-.4-.4-.667zm-2 .533c-.133.267-.267.667-.4 1.2-.4.933-1.067 2.133-2 3.467C24 23.333 20.934 25.733 16 25.733s-8-2.4-9.867-4.933c-.933-1.2-1.6-2.533-2-3.467-.267-.533-.267-.8-.4-1.2v-.266c.133-.267.267-.667.533-1.2.533-.8 1.333-2.133 2.4-3.333 2-2.533 5.2-4.933 9.333-4.933s7.333 2.4 9.333 4.933c1.067 1.333 1.733 2.533 2.267 3.467.267.533.4.933.533 1.2.133 0 .133 0 .133.133z'/%3e%3cpath d='M16 11.733c-2.4 0-4.267 2-4.267 4.267s2 4.267 4.267 4.267 4.267-2 4.267-4.267S18.4 11.733 16 11.733zM9.6 16c0-3.467 2.8-6.4 6.4-6.4 3.467 0 6.4 2.8 6.4 6.4 0 3.467-2.8 6.4-6.4 6.4-3.467 0-6.4-2.933-6.4-6.4z'/%3e%3c/svg%3e") no-repeat 50% 50%;
  mask: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3e%3cpath d='M30.267 15.6v-.133c0-.133-.133-.267-.133-.4-.133-.267-.267-.8-.533-1.333-.533-1.067-1.333-2.4-2.533-3.867-2.267-2.8-5.867-5.733-10.933-5.733s-8.8 3.067-11.067 5.867c-1.067 1.333-2 2.8-2.533 3.867-.267.533-.4.933-.533 1.333-.133.133-.133.267-.133.4v.133a.406.406 0 0 0 0 .533v.133c0 .133 0 .267.133.4s.267.8.533 1.333S3.602 20.666 4.802 22c2.133 2.8 5.733 5.733 11.467 5.733S25.602 24.8 27.736 22c1.067-1.467 1.733-2.8 2.267-3.867.267-.533.4-.933.533-1.333 0-.133.133-.267.133-.4v-.133c-.267-.267-.267-.4-.4-.667zm-2 .533c-.133.267-.267.667-.4 1.2-.4.933-1.067 2.133-2 3.467C24 23.333 20.934 25.733 16 25.733s-8-2.4-9.867-4.933c-.933-1.2-1.6-2.533-2-3.467-.267-.533-.267-.8-.4-1.2v-.266c.133-.267.267-.667.533-1.2.533-.8 1.333-2.133 2.4-3.333 2-2.533 5.2-4.933 9.333-4.933s7.333 2.4 9.333 4.933c1.067 1.333 1.733 2.533 2.267 3.467.267.533.4.933.533 1.2.133 0 .133 0 .133.133z'/%3e%3cpath d='M16 11.733c-2.4 0-4.267 2-4.267 4.267s2 4.267 4.267 4.267 4.267-2 4.267-4.267S18.4 11.733 16 11.733zM9.6 16c0-3.467 2.8-6.4 6.4-6.4 3.467 0 6.4 2.8 6.4 6.4 0 3.467-2.8 6.4-6.4 6.4-3.467 0-6.4-2.933-6.4-6.4z'/%3e%3c/svg%3e") no-repeat 50% 50%;
  -webkit-mask-size: cover; mask-size: cover;
}
.ol .password-toggle-btn .password-toggle-indicator:hover { color: #434a57; }
.ol .password-toggle-btn .password-toggle-check { position: absolute; left: 0; z-index: -1; width: 1rem; height: 1.25rem; opacity: 0; }
.ol .password-toggle-btn .password-toggle-check:checked ~ .password-toggle-indicator::before {
  -webkit-mask: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3e%3cpath d='M2 2c.4-.4 1.067-.4 1.467 0l26.8 26.8c.4.4.4 1.067 0 1.467s-1.067.4-1.467 0l-4.8-4.8c-.133 0-.133.133-.267.133-4 1.867-7.333 2.4-10.267 2s-5.2-1.733-6.933-3.2A17.207 17.207 0 0 1 2.8 19.467c-.4-.8-.667-1.467-.8-2.133-.133-.267-.133-.533-.267-.8 0-.133-.133-.4-.133-.667s.133-.667.267-.933c.133-.267.267-.533.4-.933.4-.667.8-1.333 1.333-2.133.933-1.2 2.133-2.8 2.933-3.867L2 3.334c-.4-.4-.4-.933 0-1.333zm6 7.467c-.8.933-1.867 2.4-2.8 3.733A10.76 10.76 0 0 0 4 15.067c-.133.267-.267.533-.267.667V16s.133.267.133.533c.133.533.4 1.067.8 1.733a15.323 15.323 0 0 0 3.333 4.4c1.467 1.333 3.467 2.4 5.867 2.8 2.4.267 5.2 0 8.8-1.6l-2.8-2.8c-1.2.8-2.533 1.333-3.867 1.333-1.733 0-3.333-.667-4.533-1.867s-1.867-2.8-1.867-4.533c0-1.333.4-2.667 1.2-3.733l-2.8-2.8zM11.6 16c0 1.2.533 2.267 1.333 3.067C13.733 20 14.8 20.4 16 20.4c.8 0 1.6-.267 2.267-.667l-6-6c-.4.667-.667 1.467-.667 2.267zm3.6-11.733h-.133l-.8.133-.933.267c-.533 0-.933.533-.8 1.067s.667.933 1.2.8l1.6-.267h1.6l.8.133.667.133.533.133 1.333.533c.133 0 .267.133.4.133s.133.133.267.133l.667.267 2.667 2 .4.4.4.533.4.4c.133.133.267.4.4.533s.133.267.267.4l.4.4c0 .4.133.533.133.667l.267.4c.133.133.133.267.267.4l.267.4.133.267v.133c0 .133.133.133.133.267l.133.133c0 .133.133.267.133.267l.133.267c0 .133 0 .267.133.4v.399l-.133.267c0 .133-.133.267-.133.267l-.267.8-.8 1.2c-.267.533-.133 1.067.4 1.333s1.067.133 1.333-.4l.267-.533.267-.4.533-.8.133-.4c0-.133.133-.267.133-.4l.133-.267v-.133s.133-.133.133-.267v-.8.133c0-.133 0-.4-.133-.533v-.267L30 15.065l-.133-.267v-.266l-.133-.267v-.399l-.533-.8v-.133c0-.133-.133-.133-.133-.267v-.133l-.267-.4c-.133-.133-.267-.4-.267-.533l-.267-.4c-.133-.133-.267-.4-.4-.533l-.4-.4c-.133-.133-.267-.4-.4-.533l-.4-.533-.4-.533-1.2-.667-.533-.4-.533-.4-.533-.4-.667-.4-.667-.4s-.133 0-.133-.133c-.133-.133-.4-.133-.533-.267l-.667-.267h-.133l-.8-.267h-.133l-1.067-.4-.8-.133h-.133l-.8-.133h-1.733z'/%3e%3c/svg%3e") no-repeat 50% 50%;
  mask: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3e%3cpath d='M2 2c.4-.4 1.067-.4 1.467 0l26.8 26.8c.4.4.4 1.067 0 1.467s-1.067.4-1.467 0l-4.8-4.8c-.133 0-.133.133-.267.133-4 1.867-7.333 2.4-10.267 2s-5.2-1.733-6.933-3.2A17.207 17.207 0 0 1 2.8 19.467c-.4-.8-.667-1.467-.8-2.133-.133-.267-.133-.533-.267-.8 0-.133-.133-.4-.133-.667s.133-.667.267-.933c.133-.267.267-.533.4-.933.4-.667.8-1.333 1.333-2.133.933-1.2 2.133-2.8 2.933-3.867L2 3.334c-.4-.4-.4-.933 0-1.333zm6 7.467c-.8.933-1.867 2.4-2.8 3.733A10.76 10.76 0 0 0 4 15.067c-.133.267-.267.533-.267.667V16s.133.267.133.533c.133.533.4 1.067.8 1.733a15.323 15.323 0 0 0 3.333 4.4c1.467 1.333 3.467 2.4 5.867 2.8 2.4.267 5.2 0 8.8-1.6l-2.8-2.8c-1.2.8-2.533 1.333-3.867 1.333-1.733 0-3.333-.667-4.533-1.867s-1.867-2.8-1.867-4.533c0-1.333.4-2.667 1.2-3.733l-2.8-2.8zM11.6 16c0 1.2.533 2.267 1.333 3.067C13.733 20 14.8 20.4 16 20.4c.8 0 1.6-.267 2.267-.667l-6-6c-.4.667-.667 1.467-.667 2.267zm3.6-11.733h-.133l-.8.133-.933.267c-.533 0-.933.533-.8 1.067s.667.933 1.2.8l1.6-.267h1.6l.8.133.667.133.533.133 1.333.533c.133 0 .267.133.4.133s.133.133.267.133l.667.267 2.667 2 .4.4.4.533.4.4c.133.133.267.4.4.533s.133.267.267.4l.4.4c0 .4.133.533.133.667l.267.4c.133.133.133.267.267.4l.267.4.133.267v.133c0 .133.133.133.133.267l.133.133c0 .133.133.267.133.267l.133.267c0 .133 0 .267.133.4v.399l-.133.267c0 .133-.133.267-.133.267l-.267.8-.8 1.2c-.267.533-.133 1.067.4 1.333s1.067.133 1.333-.4l.267-.533.267-.4.533-.8.133-.4c0-.133.133-.267.133-.4l.133-.267v-.133s.133-.133.133-.267v-.8.133c0-.133 0-.4-.133-.533v-.267L30 15.065l-.133-.267v-.266l-.133-.267v-.399l-.533-.8v-.133c0-.133-.133-.133-.133-.267v-.133l-.267-.4c-.133-.133-.267-.4-.267-.533l-.267-.4c-.133-.133-.267-.4-.4-.533l-.4-.4c-.133-.133-.267-.4-.4-.533l-.4-.533-.4-.533-1.2-.667-.533-.4-.533-.4-.533-.4-.667-.4-.667-.4s-.133 0-.133-.133c-.133-.133-.4-.133-.533-.267l-.667-.267h-.133l-.8-.267h-.133l-1.067-.4-.8-.133h-.133l-.8-.133h-1.733z'/%3e%3c/svg%3e") no-repeat 50% 50%;
}

.ol .ol-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; padding-bottom: 1.5rem; }
.ol .ol-check { margin: .25rem 0; }
.ol .form-check-input {
  flex-shrink: 0; width: 1.125rem; height: 1.125rem; margin: .1875rem 0 0; vertical-align: top;
  -webkit-appearance: none; appearance: none; background-color: transparent;
  background-repeat: no-repeat; background-position: center; background-size: contain;
  border: 1px solid #b4bbc3; border-radius: .375rem; cursor: pointer;
}
.ol .form-check-input:focus { border-color: #576071; outline: 0; box-shadow: 0 0 0 .25rem rgba(68, 140, 116, .25); }
.ol .form-check-input:checked {
  background-color: #448c74; border-color: #448c74;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3e%3cpath fill='none' stroke='%23fff' stroke-linecap='round' stroke-linejoin='round' stroke-width='3' d='m6 10 3 3 6-6'/%3e%3c/svg%3e");
}
.ol .form-check-label { display: inline-block; margin-left: .25rem; color: #576071; cursor: pointer; }
.ol .ol-forgot { margin: .25rem 0; font-size: .875rem; font-weight: 600; text-decoration: none; }

.ol .ol-cap-wrap { padding-bottom: 1rem; margin-bottom: .25rem; }
.ol .ol-cap { margin-bottom: 1rem; }
.ol .ol-cap-row { display: flex; align-items: center; gap: .5rem; margin-bottom: .5rem; }
.ol .ol-cap-row img { display: block; }
.ol .ol-cap-btn {
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #dee2e6; border-radius: 6px; width: 38px; height: 38px;
  background: #efefef; color: #000; cursor: pointer; padding: 0;
}

.ol .btn-primary {
  display: flex; align-items: center; justify-content: center; gap: .5rem;
  width: 100%; margin: 1rem 0; padding: .575rem 1.25rem;
  font-family: inherit; font-size: .75rem; font-weight: 600; line-height: 1.4; color: #fff; text-align: center;
  background-color: #448c74; border: 1px solid #448c74; border-radius: .3rem; cursor: pointer;
  transition: color .2s ease-in-out, background-color .2s ease-in-out, border-color .2s ease-in-out;
}
.ol .btn-primary:hover { background-color: #3a7763; border-color: #36705d; }
.ol .btn-primary:disabled { opacity: .65; pointer-events: none; }
.ol .ol-spin {
  width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent;
  border-radius: 50%; animation: ol-spin .7s linear infinite;
}
@keyframes ol-spin { to { transform: rotate(360deg); } }

.ol .ol-msg { text-align: center; font-size: .875rem; margin-bottom: .5rem; }
.ol .ol-caps { text-align: center; font-weight: 700; color: #ed5050; filter: drop-shadow(2px 2px 2px gray); }

.ol .ol-right { display: none; width: 50%; color: #fff; }
@media (min-width: 768px) { .ol .ol-right { display: block; } }

.ol .orbit-container {
  position: relative; width: 650px; height: 650px; margin: 0 auto; text-align: center;
  display: flex; justify-content: center; align-items: center;
}
.ol .orbit-container::before, .ol .orbit-container::after, .ol .largest-ring-visual {
  content: ''; position: absolute; border: 2px solid rgb(255, 255, 255); border-radius: 50%; pointer-events: none;
}
.ol .orbit-container::before { width: calc(var(--ring1-radius) * 2); height: calc(var(--ring1-radius) * 2); }
.ol .orbit-container::after  { width: calc(var(--ring2-radius) * 2); height: calc(var(--ring2-radius) * 2); }
.ol .largest-ring-visual     { width: calc(var(--ring3-radius) * 2); height: calc(var(--ring3-radius) * 2); }

.ol .central-element {
  width: 250px; height: 250px; background-color: #fff; border-radius: 50%;
  position: absolute; z-index: 10; cursor: pointer; overflow: hidden;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2); transition: transform 0.3s ease;
}
.ol .central-element:hover { opacity: 0.9; transform: scale(1.03); }
.ol .central-element-image {
  display: block; width: 100%; height: 100%;
  object-fit: cover; object-position: center 10%; filter: grayscale(100%);
}
.ol .central-element-fallback {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 96px; color: #448c74;
}

.ol .orbiting-element {
  width: 50px; height: 50px; border-radius: 50%; position: absolute; z-index: 20;
  display: flex; justify-content: center; align-items: center;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3); border: 2px solid white;
}
.ol .orbiting-element i { font-size: 20px; color: white; line-height: 1; }
.ol .orbiting-element.whatsapp { background-color: #25D366; }
.ol .orbiting-element.sms      { background-color: #3498db; }
.ol .orbiting-element.web-chat { background-color: #f39c12; }
.ol .orbiting-element.call     { background-color: #e74c3c; }
.ol .orbiting-element.email    { background-color: #9b59b6; }
.ol .orbiting-element.chat     { background-color: #1abc9c; }

@keyframes ol-orbit {
  0%   { transform: rotate(0deg)   translateX(var(--orbit-radius)) rotate(0deg); }
  100% { transform: rotate(360deg) translateX(var(--orbit-radius)) rotate(-360deg); }
}
.ol .orbiting-element-1, .ol .orbiting-element-4 { --orbit-radius: var(--ring1-radius); animation: ol-orbit 10s linear infinite; }
.ol .orbiting-element-5, .ol .orbiting-element-6 { --orbit-radius: var(--ring2-radius); animation: ol-orbit 12s linear infinite; }
.ol .orbiting-element-2, .ol .orbiting-element-3 { --orbit-radius: var(--ring3-radius); animation: ol-orbit 14s linear infinite; }
.ol .orbiting-element-1 { animation-delay: -7.5s; }
.ol .orbiting-element-4 { animation-delay: -2.5s; }
.ol .orbiting-element-5 { animation-delay: -1.5s; }
.ol .orbiting-element-6 { animation-delay: -7.5s; }
.ol .orbiting-element-2 { animation-delay: -5.25s; }
.ol .orbiting-element-3 { animation-delay: -12.25s; }

.ol .ol-tagline { padding-bottom: 1rem; text-align: center; color: #fff; }
.ol .ol-tagline h5 { margin: 0; font-size: 1.25rem; font-weight: 600; line-height: 1.3; color: #fff; }
.ol .ol-tagline p { margin: 0; }
`;

/* ======================= CAPTCHA ======================= */
const CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rand = (min, max) => Math.random() * (max - min) + min;

function makeCaptcha(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CAPTCHA_CHARS.charAt(Math.floor(Math.random() * CAPTCHA_CHARS.length));
  }

  const W = 300, H = 76;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#eef3f8");
  bg.addColorStop(1, "#e4ece6");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(${rand(60, 160)},${rand(60, 160)},${rand(60, 160)},0.35)`;
    ctx.beginPath();
    ctx.arc(rand(0, W), rand(0, H), rand(0.8, 2), 0, Math.PI * 2);
    ctx.fill();
  }

  const slot = W / (length + 1);
  for (let i = 0; i < length; i++) {
    ctx.save();
    ctx.translate(slot * (i + 1) - 6, H / 2 + rand(-6, 6));
    ctx.rotate(rand(-0.4, 0.4));
    ctx.font = `bold ${Math.floor(rand(38, 48))}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgb(${Math.floor(rand(20, 110))},${Math.floor(rand(20, 110))},${Math.floor(rand(20, 110))})`;
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(${rand(40, 150)},${rand(40, 150)},${rand(40, 150)},0.6)`;
    ctx.lineWidth = rand(1, 2.5);
    ctx.beginPath();
    ctx.moveTo(rand(0, W), rand(0, H));
    ctx.bezierCurveTo(rand(0, W), rand(0, H), rand(0, W), rand(0, H), rand(0, W), rand(0, H));
    ctx.stroke();
  }

  return { code, img: canvas.toDataURL("image/png") };
}

/* ======================= VALIDATION ======================= */
function validate(username, password) {
  if (!username || username.length < 3) return "Username must be at least 3 characters";
  if (!password || password.length < 3) return "Password must be at least 3 characters";
  return null;
}

/* ======================= LOGIN REQUEST ======================= */
async function loginRequest(payload, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    let data = null;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = {
        status: "failed",
        message: text && text.length < 300 ? text : `Server returned HTTP ${response.status}`,
      };
    }

    if (!response.ok) {
      return {
        status: "failed",
        message: data?.message || data?.detail || `Server error (${response.status})`,
      };
    }
    return data;
  } catch (err) {
    if (attempt < MAX_RETRIES && (err.name === "AbortError" || err.name === "TypeError")) {
      return loginRequest(payload, attempt + 1);
    }
    if (err.name === "AbortError") throw new Error("REQUEST_TIMEOUT");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ==================== COMPONENT ==================== */
export default function Login() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [captchaInput, setCaptchaInput] = useState("");
  const [touched, setTouched] = useState({ username: false, password: false });
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [typing, setTyping] = useState("Omni Channel App");
  const [paused, setPaused] = useState(false);
  const [logoOk, setLogoOk] = useState(true);
  const [captcha, setCaptcha] = useState(() => makeCaptcha());

  const refreshCaptcha = () => {
    setCaptcha(makeCaptcha());
    setCaptchaInput("");
  };

  /* Inter font + Font Awesome */
  useEffect(() => {
    const urls = [
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
    ];
    const links = urls.map((href) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      document.head.appendChild(l);
      return l;
    });
    const prevTitle = document.title;
    document.title = "Omni App";
    return () => {
      links.forEach((l) => l.remove());
      document.title = prevTitle;
    };
  }, []);

  /* caps lock */
  useEffect(() => {
    const onKey = (e) => setCapsOn(!!(e.getModifierState && e.getModifierState("CapsLock")));
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* typewriter */
  useEffect(() => {
    const text = "Omni Channel App !";
    let index = 0;
    let timer;
    const type = () => {
      if (index < text.length) {
        const ch = text.charAt(index);
        setTyping((t) => t + ch);
        index++;
        timer = setTimeout(type, 100);
      } else {
        timer = setTimeout(() => {
          setTyping("");
          index = 0;
          type();
        }, 1000);
      }
    };
    type();
    return () => clearTimeout(timer);
  }, []);

  /* orbit pause/play */
  const showMessage = (msg) => {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;top:20px;right:20px;background-color:#2c3e50;color:white;padding:15px 25px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);font-size:14px;z-index:1000;opacity:0;transition:opacity 0.5s ease;";
    box.textContent = msg;
    document.body.appendChild(box);
    setTimeout(() => (box.style.opacity = 1), 10);
    setTimeout(() => {
      box.style.opacity = 0;
      box.addEventListener("transitionend", () => box.remove());
    }, 3000);
  };
  const toggleOrbit = () => {
    const next = !paused;
    setPaused(next);
    document.querySelectorAll(".ol .orbiting-element").forEach((el) => {
      el.style.animationPlayState = next ? "paused" : "running";
    });
    showMessage(next ? "Animation Paused" : "Animation Running");
  };

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      const trimUser = username.trim().toLowerCase();
      const trimPass = password.trim();

      setTouched({ username: true, password: true });
      setMessage("");

      const validationError = validate(trimUser, trimPass);
      if (validationError) {
        setMessage(validationError);
        return;
      }

      if (captchaInput.trim().toUpperCase() !== captcha.code) {
        setMessage("Invalid captcha ❌");
        refreshCaptcha();
        return;
      }

      setSubmitting(true);
      setMessage("Logging in...");

      try {
        const data = await loginRequest({ username: trimUser, password: trimPass });
        if (data && (data.status === "success" || data.success === true)) {
          sessionStorage.clear();
          sessionStorage.setItem("user_id", String(data.user_id || data.id || ""));
          sessionStorage.setItem("role", data.role || "user");
          sessionStorage.setItem(
            "user",
            JSON.stringify({
              id: data.user_id || data.id || "",
              username: trimUser,
              role: data.role || "user",
              credit: data.credit || 0,
              panelToken: data.panel_token || "",
            })
          );
          setMessage("Login successful ✅");
          setTimeout(() => navigate("/productshome"), 300);
        } else {
          setMessage(data?.message || data?.detail || "Invalid username or password ❌");
          refreshCaptcha();
        }
      } catch (err) {
        console.error("Login error:", err);
        if (err.message === "REQUEST_TIMEOUT") {
          setMessage("Server is taking too long to respond. Please try again ❌");
        } else if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
          setMessage("Unable to connect to server. Please check API server ❌");
        } else {
          setMessage(err.message || "Server error ❌");
        }
        refreshCaptcha();
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, captchaInput, captcha, navigate]
  );

  const userErr =
    touched.username && username.trim().length < 3 ? "Username must be at least 3 characters" : "";
  const passErr =
    touched.password && password.trim().length < 3 ? "Password must be at least 3 characters" : "";

  const isSuccess = message.includes("successful");
  const isInfo = message === "Logging in...";

  return (
    <div className="ol">
      <style>{STYLES}</style>

      <div className="ol-wrap">
        {/* ============ LEFT : FORM ============ */}
        <div className="ol-left">
          <div className="ol-card">
            <div className="ol-card-body">
              <marquee behavior="alternate">
                <h5>{SITE_TEXT}</h5>
              </marquee>

              <form id="signInForm" onSubmit={handleSubmit} noValidate>
                <div className="ol-form">
                  <h3>Sign in</h3>
                  <p className="ol-sub">
                    Don't have an account yet?&nbsp;&nbsp;
                    <a href="signup">Register here!</a>
                  </p>

                  {/* username */}
                  <div className="ol-group">
                    <div className="ol-rel">
                      <i className="fa-solid fa-user ol-ico"></i>
                      <input
                        className={`form-control ${userErr ? "has-err" : ""}`}
                        type="text"
                        placeholder="Username"
                        id="UserName"
                        name="username"
                        maxLength={50}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onBlur={() => setTouched((p) => ({ ...p, username: true }))}
                        autoComplete="username"
                        autoCapitalize="none"
                        disabled={submitting}
                      />
                    </div>
                    {userErr && <div className="ol-err">{userErr}</div>}
                  </div>

                  {/* password */}
                  <div className="ol-group-pass">
                    <div className="ol-rel">
                      <i className="fa-solid fa-lock ol-ico"></i>
                      <div className="password-toggle">
                        <input
                          className={`form-control ${passErr ? "has-err" : ""}`}
                          type={showPass ? "text" : "password"}
                          placeholder="Password"
                          id="Password"
                          name="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onBlur={() => setTouched((p) => ({ ...p, password: true }))}
                          autoComplete="current-password"
                          disabled={submitting}
                        />
                        <label className="password-toggle-btn" aria-label="Show/hide password">
                          <input
                            className="password-toggle-check"
                            type="checkbox"
                            checked={showPass}
                            onChange={(e) => setShowPass(e.target.checked)}
                          />
                          <span className="password-toggle-indicator"></span>
                        </label>
                      </div>
                    </div>
                    {passErr && <div className="ol-err">{passErr}</div>}
                  </div>

                  {/* remember + forgot */}
                  <div className="ol-row">
                    <div className="ol-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="keep-signedin"
                        name="RememberMe"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="keep-signedin">
                        Keep me signed in
                      </label>
                    </div>
                    <a className="ol-forgot" href="/forgot-password">
                      Forgot password?
                    </a>
                  </div>

                  {/* captcha */}
                  <div className="ol-cap-wrap">
                    <div className="ol-cap" id="captcha-widget-signin">
                      <div className="ol-cap-row">
                        <img
                          id="captcha-img-signin"
                          src={captcha.img}
                          alt="CAPTCHA"
                          style={{
                            width: "150px",
                            height: "38px",
                            border: "1px solid #dee2e6",
                            borderRadius: "6px",
                          }}
                        />
                        <button
                          type="button"
                          id="captcha-refresh-btn-signin"
                          className="ol-cap-btn"
                          title="Refresh CAPTCHA"
                          onClick={refreshCaptcha}
                          disabled={submitting}
                        >
                          <i className="fa fa-refresh"></i>
                        </button>
                        <input
                          type="text"
                          id="CaptchaInput-signin"
                          name="CaptchaInput"
                          className="form-control form-control-sm"
                          placeholder="Enter code"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          maxLength={6}
                          required
                          value={captchaInput}
                          onChange={(e) => setCaptchaInput(e.target.value)}
                          disabled={submitting}
                          style={{
                            maxWidth: "160px",
                            height: "38px",
                            letterSpacing: "3px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            paddingLeft: ".875rem",
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <button className="btn-primary" type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <span className="ol-spin" /> Signing in...
                      </>
                    ) : (
                      "Sign in"
                    )}
                  </button>

                  {message && (
                    <div
                      className="ol-msg"
                      style={{
                        color: isSuccess ? "#3fca90" : isInfo ? "#576071" : "#ed5050",
                      }}
                    >
                      {message}
                    </div>
                  )}

                  <div className="ol-caps" style={{ display: capsOn ? "block" : "none" }}>
                    CapsLock is ON
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* ============ RIGHT : ORBIT ============ */}
        <div className="ol-right">
          <div className="orbit-container">
            <div className="largest-ring-visual"></div>

            <div className="central-element" onClick={toggleOrbit}>
              {logoOk ? (
                <img
                  className="central-element-image"
                  src={LOGO_URL}
                  alt="logo"
                  onError={() => setLogoOk(false)}
                />
              ) : (
                <div className="central-element-fallback">
                  <i className="fa-solid fa-comments"></i>
                </div>
              )}
            </div>

            <div className="orbiting-element whatsapp orbiting-element-1">
              <i className="fa-brands fa-whatsapp"></i>
            </div>
            <div className="orbiting-element chat orbiting-element-4">
              <i className="fa-solid fa-comment-dots"></i>
            </div>
            <div className="orbiting-element sms orbiting-element-5">
              <i className="fa-solid fa-message"></i>
            </div>
            <div className="orbiting-element web-chat orbiting-element-6">
              <i className="fa-solid fa-comments"></i>
            </div>
            <div className="orbiting-element call orbiting-element-2">
              <i className="fa-solid fa-phone"></i>
            </div>
            <div className="orbiting-element email orbiting-element-3">
              <i className="fa-solid fa-envelope"></i>
            </div>
          </div>

          <div className="ol-tagline">
            <h5>{typing}</h5>
            <p>Omni connects WhatsApp, SMS, RCS, Email, Voice &amp; AI — all in one place .</p>
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * [vrmViewer.js] - VRM(3Dアバター)専用のセクションレンダラー
 *
 * `VRMs.corefolder_VRMPath`（`#VRMFilePath[]`）を、キャラシート上で3Dビューアとして表示する。
 * - `vrmViewerSection`（`CharacterSectionRendererRegistry`）: `$display.sectionWrapper === 'vrmViewerSection'`
 *   宣言のフィールドを検出し、サムネイル + 起動ボタン + 3Dステージのカードを1エントリごとに描画する。
 * - three.js / `@pixiv/three-vrm`（`pages/vendor/` に同梱）は「3Dビューアを起動」ボタン押下時にのみ
 *   動的 import する。通常のページ閲覧・VRMを持たないキャラの表示・他フィールドの描画では一切ロードしない。
 * - URLの組み立ては `helpers.buildVrmAssetUrl`（`pages/characters.js`）に委譲し、本ファイルはパス規約を持たない
 *   （`TailsUnit_PNGName` に対する `helpers.buildTailsUnitImageUrl` と同じ役割分担）。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies CharacterSectionRendererRegistry (section-wrapper-common.js), pages/vendor/three, pages/vendor/three-vrm
 */
(() => {
	const sectionRegistry = globalThis.CharacterSectionRendererRegistry;
	if (!sectionRegistry?.registerSectionRenderer) return;

	// three.js / three-vrm の動的import結果をモジュールスコープでキャッシュする。
	// 同一ページに複数のVRMカードがあっても、実際のimport/ネットワーク要求は1回だけにする。
	let threeModulesPromise = null;

	/**
	 * three本体・GLTFLoader・OrbitControls・three-vrm を動的importする。
	 * @returns {Promise<{THREE:Object, GLTFLoader:Function, OrbitControls:Function, VRM:Object}>}
	 */
	function loadThreeModules() {
		if (!threeModulesPromise) {
			threeModulesPromise = Promise.all([
				import('three'),
				import('three/addons/loaders/GLTFLoader.js'),
				import('three/addons/controls/OrbitControls.js'),
				import('@pixiv/three-vrm')
			]).then(([THREE, gltfMod, controlsMod, VRM]) => ({
				THREE,
				GLTFLoader: gltfMod.GLTFLoader,
				OrbitControls: controlsMod.OrbitControls,
				VRM
			}));
		}
		return threeModulesPromise;
	}

	/**
	 * three.js シーンを初期化し、VRMを読み込んでレンダリングループを開始する。
	 * `renderDetail`（characters.js）が別キャラの描画で `#detail` を丸ごと差し替えると、
	 * ここで作った canvas はDOMから切り離されるが、rAFループ自体は自動停止しない。
	 * そのため毎フレーム `canvas.isConnected` を確認し、切断されたらループを止めて破棄する
	 * （呼び出し側 = characters.js 本体の改修は不要な自己完結型のクリーンアップ）。
	 * @param {{stage: HTMLElement, vrmUrl: string}} opts
	 * @returns {Promise<void>}
	 */
	async function initViewer({ stage, vrmUrl }) {
		const { THREE, GLTFLoader, OrbitControls, VRM } = await loadThreeModules();

		const width = stage.clientWidth || 320;
		const height = stage.clientHeight || 320;

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setSize(width, height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		stage.appendChild(renderer.domElement);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
		camera.position.set(0, 1.3, 2.2);

		scene.add(new THREE.AmbientLight(0xffffff, 1.2));
		const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
		dirLight.position.set(1, 1, 1);
		scene.add(dirLight);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(0, 1.0, 0);
		controls.enableDamping = true;
		controls.update();

		const loader = new GLTFLoader();
		loader.register((parser) => new VRM.VRMLoaderPlugin(parser));

		const gltf = await new Promise((resolve, reject) => {
			loader.load(vrmUrl, resolve, undefined, reject);
		});

		const vrm = gltf.userData.vrm || null;
		if (vrm) {
			VRM.VRMUtils.rotateVRM0(vrm);
			scene.add(vrm.scene);
		}

		const canvas = renderer.domElement;
		const clock = new THREE.Clock();

		const handleResize = () => {
			const w = stage.clientWidth || width;
			const h = stage.clientHeight || height;
			renderer.setSize(w, h);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		};
		window.addEventListener('resize', handleResize);

		const tick = () => {
			if (!canvas.isConnected) {
				window.removeEventListener('resize', handleResize);
				controls.dispose();
				renderer.dispose();
				return;
			}
			const delta = clock.getDelta();
			if (vrm) vrm.update(delta);
			controls.update();
			renderer.render(scene, camera);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	/**
	 * 1件のVRMエントリを「サムネイル（左）+ 起動ボタン/3Dステージ（右）」の2カラムカードとして描画する。
	 * 狭い画面では SASS 側（.model-viewer）のメディアクエリで縦積みにフォールバックする。
	 * @param {string} relPath - `<category>_VRMPath` の1要素（例: "16/vrm_corefolder16"）
	 * @param {string} folderHint - カテゴリフォルダ名（例: "corefolder"。フィールド名 `corefolder_VRMPath` から導出）
	 * @param {Object} helpers - characters.js から渡される DOM/format helper 群
	 * @param {string} lang - 'jp' | 'en'
	 * @returns {HTMLElement|null}
	 */
	function buildViewerCard(relPath, folderHint, helpers, lang) {
		const { el, buildVrmAssetUrl } = helpers;
		if (typeof el !== 'function' || typeof buildVrmAssetUrl !== 'function') return null;

		const vrmUrl = buildVrmAssetUrl(relPath, '.vrm', folderHint);
		if (!vrmUrl) return null;
		const thumbUrl = buildVrmAssetUrl(relPath, '.png', folderHint);

		const launchLabel = lang === 'en' ? 'Launch 3D Viewer' : '3Dビューアを起動';
		const loadingLabel = lang === 'en' ? 'Loading…' : '読み込み中…';
		const errorLabel = lang === 'en'
			? 'Failed to load the 3D viewer. Your browser may not support WebGL.'
			: '3Dビューアの読み込みに失敗しました。ブラウザがWebGLに対応していない可能性があります。';
		const hintLabel = lang === 'en' ? 'Drag to rotate / Scroll to zoom' : 'ドラッグで回転 / スクロールで拡大縮小';

		const stage = el('div', { class: 'model-viewer__stage', hidden: true }, []);
		const hint = el('div', { class: 'model-viewer__hint', hidden: true }, [hintLabel]);
		const errorBox = el('div', { class: 'model-viewer__error', hidden: true }, []);

		let started = false;
		const launchBtn = el('button', {
			type: 'button',
			class: 'model-viewer__launch-btn',
			onclick: async () => {
				if (started) return;
				started = true;
				launchBtn.disabled = true;
				launchBtn.textContent = loadingLabel;
				errorBox.hidden = true;
				stage.hidden = false;
				try {
					await initViewer({ stage, vrmUrl });
					hint.hidden = false;
					launchBtn.remove();
				} catch (err) {
					console.error('VRMビューアの初期化に失敗しました:', err);
					stage.hidden = true;
					errorBox.hidden = false;
					errorBox.textContent = errorLabel;
					launchBtn.disabled = false;
					launchBtn.textContent = launchLabel;
					started = false;
				}
			}
		}, [launchLabel]);

		const poster = thumbUrl
			? el('img', {
				class: 'model-viewer__poster',
				src: thumbUrl,
				alt: lang === 'en' ? '3D avatar preview' : '3Dアバターのプレビュー画像',
				loading: 'lazy'
			}, [])
			: null;

		// ポスター画像（左カラム）と 起動ボタン/ステージ（右カラム）を分離し、
		// 3Dビューアがイメージ画像の右隣に並ぶレイアウトにする（SASS: .model-viewer__media / __body）
		const media = poster ? el('div', { class: 'model-viewer__media' }, [poster]) : null;
		const body = el('div', { class: 'model-viewer__body' }, [launchBtn, stage, hint, errorBox]);
		return el('div', { class: 'model-viewer' }, [media, body].filter(Boolean));
	}

	sectionRegistry.registerSectionRenderer('vrmViewerSection', {
		match: (context) => {
			const display = context?.display ?? context?.item?.display ?? {};
			return display?.sectionWrapper === 'vrmViewerSection';
		},

		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const helpers = context?.helpers || {};
			const { wrapStandaloneSection, getCurrentPageLanguage, el, isPlainObject } = helpers;
			if (typeof el !== 'function') return null;

			// `VRMs` は `Images` と同様、`<category>_VRMPath` を複数持てるコンテナオブジェクト。
			// フォルダ名（"corefolder" 等）はフィールド名の接頭辞から導出する（corefolder_PNGPath と同じ規約）。
			const categories = isPlainObject?.(item?.value) ? item.value : null;
			if (!categories) return null;

			const lang = typeof getCurrentPageLanguage === 'function' ? getCurrentPageLanguage() : 'jp';
			const cards = [];
			for (const [key, value] of Object.entries(categories)) {
				const match = /^(.+)_VRMPath$/.exec(key);
				if (!match) continue;
				const folderHint = match[1];
				const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
				for (const relPath of list) {
					if (typeof relPath !== 'string') continue;
					const card = buildViewerCard(relPath, folderHint, helpers, lang);
					if (card) cards.push(card);
				}
			}
			if (!cards.length) return null;

			const listEl = el('div', { class: 'model-viewer-list' }, cards);
			return typeof wrapStandaloneSection === 'function' ? wrapStandaloneSection(item, [listEl]) : listEl;
		}
	});
})();

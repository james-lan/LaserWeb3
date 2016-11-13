// LaserWeb scope
var lw = lw || {};

(function () {
    'use strict';

    // Viewer scope
    lw.viewer = {
        $render     : null,
        size        : null,
        scene       : null,
        camera      : null,
        renderer    : null,
        viewControls: null,
        raycaster   : null,
        mouse       : null,
        workspace   : null,
        objects     : null,
        overlay     : null,
        grid        : null,
        axes        : null,
        cursor      : null,
        lights      : null,
        bullseye    : null
    };

    // -------------------------------------------------------------------------

    // Rendering mode detection
    var canvasRenderer = !!window.CanvasRenderingContext2D;
    var webglRenderer  = (function() {
        try {
            return !!window.WebGLRenderingContext && !!document.createElement('canvas').getContext('experimental-webgl');
        }
        catch (e) {
            return false;
        }
    })();

    if (webglRenderer) {
        lw.log.print('<strong>WebGL Support found!</strong> Laserweb will work optimally on this device!', 'success', 'viewer');
    }
    else {
        var message = [
            '<strong>No WebGL Support found!</strong> Laserweb may not work optimally on this device!<br />',
            '<u>Try another device with WebGL supportor or try the following:</u><br />',
            '<ul>',
            '<li>In the Chrome address bar, type: <b>chrome://flags</b> [Enter]</li>',
            '<li>Enable the <b>Override software Rendering</b></li>',
            '<li>Restart Chrome and try again</li>',
            '</ul>',
            'Sorry! :( <hr />'
        ];

        lw.log.print(message.join('\n'), 'error', 'viewer');
    };

    // -------------------------------------------------------------------------

    // Init the viewer
    lw.viewer.init = function() {
        // Get render area element
        this.$render = $('#renderArea');

        // Create size object
        this.size = { width: null, height: null, ratio: null };

        // Create mouse (vector )object
        this.mouse = new THREE.Vector3();

        // Create raycaster object
        this.raycaster = new THREE.Raycaster();

        // Create the scene object
        this.scene = new THREE.Scene();

        // Create the camera object
        this.camera = new THREE.PerspectiveCamera(75, 1, 1, 10000);

        // Set camera initial position
        this.camera.position.z = 295;

        // Create renderer object
        this.renderer = webglRenderer ? new THREE.WebGLRenderer({
            autoClearColor: true,
            antialias     : false
        }) : new THREE.CanvasRenderer();

        // Initialize the renderer
        this.renderer.setClearColor(0xffffff, 1);
        this.renderer.sortObjects = true;
        this.renderer.clear();

        // CNC mode ?
        var cncMode = lw.store.get('cncMode', 'Disable') !== 'Disable';

        // Add viewer main controls
        this.viewControls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.viewControls.target.set(0, 0, 0); // view direction perpendicular to XY-plane

        this.viewControls.enableRotate = cncMode;
        this.viewControls.enableZoom   = true;
        this.viewControls.enableKeys   = false;

        // Workspace size
        var laserXMax = parseInt(lw.store.get('laserXMax', 200));
        var laserYMax = parseInt(lw.store.get('laserYMax', 200));

        // Create main scene objects
        this.lights   = new this.Lights();
        this.grid     = new this.Grid(laserXMax, laserYMax);
        this.axes     = new this.Axes(laserXMax, laserYMax);
        this.bullseye = new this.Bullseye();
        this.cursor   = new this.Cursor();

        // Create main scene groups
        this.workspace = new THREE.Group();
        this.objects   = new THREE.Group();
        this.overlay   = new THREE.Group();

        // Add objects to target groups
        this.addObject(this.workspace, { name: 'workspace', target: 'scene' });
        this.addObject(this.objects  , { name: 'objects'  , target: 'scene' });
        this.addObject(this.overlay  , { name: 'overlay'  , target: 'scene' });

        this.addObject(this.lights, { name: 'lights', target: 'workspace' });
        this.addObject(this.grid  , { name: 'grid'  , target: 'workspace' });
        this.addObject(this.axes  , { name: 'axes'  , target: 'workspace', position: { x: 0, y: 0, z: 0 } });

        this.addObject(this.bullseye, { name: 'bullseye', target: 'overlay', position: { x: 0, y: 0, z: 0 } });
        this.addObject(this.cursor  , { name: 'cursor'  , target: 'overlay' });

        // Set initial size
        this.resize();

        // Add the renderer DOM element to target area
        this.$render.html(this.renderer.domElement);

        // Init video overlay
        this.video.init();

        // Start animate
        this.animate();

        // Events handlers -----------------------------------------------------

        // Enable/Disable 3D view
        $('#3dview').prop('checked', cncMode);
        $('#3dview').change(function() {
            lw.viewer.viewControls.enableRotate = $(this).is(":checked");
            resetView();
        });

        // On window resize
        $(window).on('resize'   , onResize)
        .on('mousedown', onMouseDown)
        .on('mousemove', onMouseMove);
    };

    // -------------------------------------------------------------------------

    // Resize the viewer to match is container size
    lw.viewer.resize = function() {
        this.size.width  = this.$render.width();
        this.size.height = this.$render.height() - 15;
        this.size.ratio  = this.size.width / this.size.height;

        this.renderer.setSize(this.size.width, this.size.height);
        this.camera.aspect = this.size.ratio;
        this.camera.updateProjectionMatrix();
    };

    function onResize(event) {
        lw.viewer.resize();
    };

    // -------------------------------------------------------------------------

    // Set cartesian origin
    lw.viewer.setObjectCartesianOrigin = function(object) {
        // If no geometry
        if (! object.geometry) {
            return;
        }

        // Center geometry
        object.geometry.center();

        // Get object bounding box size
        var bbox = new THREE.Box3().setFromObject(object);

        // Translate geometry to cartesian origin
        object.geometry.translate(bbox.max.x, bbox.max.y, bbox.max.z);
    };

    // Apply object transformations
    lw.viewer.applyObjectTransformations = function(object) {
        // If no geometry
        if (! object.geometry) {
            return;
        }

        object.updateMatrix();
        object.geometry.applyMatrix(object.matrix);
        object.position.set(0, 0, 0);
        object.rotation.set(0, 0, 0);
        object.scale.set(1, 1, 1);
        object.updateMatrix();
    };

    // Add an object to the scene
    lw.viewer.addObject = function(object, settings) {
        // Defaults settings
        settings = settings || {};

        // Force cartesian coords on 'objects' target
        if (settings.target === 'objects') {
            settings.position  = settings.position || { x: 0, y: 0, z: 0 };
            settings.cartesian = settings.cartesian === undefined ? true : false;
        }

        // Get the target object
        var target = this[settings.target || 'objects'];

        if (! (target instanceof THREE.Object3D)) {
            throw new Error(target + ' is not an instance of THREE.Object3D.');
        }

        // Set object render order (at the top by default)
        object.renderOrder = settings.order || target.children.length + 1;

        // Apply all transformations
        this.applyObjectTransformations(object);

        // Set cartesian coordinates ?
        if (settings.cartesian) {
            this.setObjectCartesianOrigin(object);
        }

        // Set object position
        if (settings.position) {
            this.moveObject(object, settings.position);
        }

        // Set object name
        object.name = settings.name || object.name;

        // Add object to target group
        target.add(object);
    };

    // -------------------------------------------------------------------------

    // Move an object at position from the origin
    lw.viewer.moveObject = function(object, x, y, z) {
        if (typeof x === 'object') {
            z = x.z;
            y = x.y;
            x = x.x;
        }

        var offsets = {
            x: -(this.grid.userData.size.x / 2),
            y: -(this.grid.userData.size.y / 2)
        };

        if (typeof object === 'string') {
            object = this[object];
        }

        object.position.set(offsets.x + x, offsets.y + y, z);
    };

    // -------------------------------------------------------------------------

    // Call the provided callback on intersected objects at current mouse position
    lw.viewer.intersectObjects = function(callback) {
        // Set the ray from the camera
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Get all intersected objects
        var intersects = this.raycaster.intersectObjects(this.scene.children, true);

        for (var i = 0, il = intersects.length; i < il; i++) {
            callback.call(this, intersects[i]);
        }
    };

    // Update the mouse vector position
    lw.viewer.onMouseEvent = function(event) {
        // Update mouse position
        var offset   = this.$render.offset();
        this.mouse.x =  ((event.clientX - offset.left) / this.size.width)  * 2 - 1;
        this.mouse.y = -((event.clientY - offset.top)  / this.size.height) * 2 + 1;

        // Check if intersected objects
        // var mouseDown   = event.type === 'mousedown';
        // var coreObjects = ['cursor', 'bullseye', 'rastermesh', 'XY', 'GridHelper'];
        // var objectName;

        this.intersectObjects(function(data) {
            // // If not an core objects
            // if (coreObjects.indexOf(data.object.parent.name) === -1 && coreObjects.indexOf(data.object.name) === -1) {
            //     // Log event on "click"
            //     if (mouseDown) {
            //         objectName = [data.object.parent.name, data.object.name].join('.');
            //         lw.log.print('Clicked on : ' + objectName, 'success', "viewer")
            //         console.log('Clicked on : ' + objectName);
            //         console.log(data.object);
            //     }
            //
            //     // Attach bounding box
            //     attachBB(data.object);
            // }

            // Move cursor at intersection position
            this.cursor.moveTo(data.point);
        });
    };

    function onMouseDown(event) {
        lw.viewer.onMouseEvent(event);
    }

    function onMouseMove(event) {
        lw.viewer.onMouseEvent(event);
    }

    // -------------------------------------------------------------------------

    lw.viewer.animate = function() {
        // Refresh the video (if enabled)
        this.video.refresh();

        // (Re)render the scene
        this.renderer.render(this.scene, this.camera);

        // Request next animation
        requestAnimationFrame(function() {
            lw.viewer.animate();
        });
    }

    // -------------------------------------------------------------------------

    lw.viewer.extendsViewToObject = function(object) {
        if (! (object instanceof THREE.Object3D)) {
            throw new Error(object + ' is not an instance of THREE.Object3D.');
        }

        var helper = new THREE.BoundingBoxHelper(object, 0xff0000);

        helper.update();

        var minx = helper.box.min.x;
        var miny = helper.box.min.y;
        var maxx = helper.box.max.x;
        var maxy = helper.box.max.y;
        var minz = helper.box.min.z;
        var maxz = helper.box.max.z;

        this.viewControls.reset();

        var lenx = maxx - minx;
        var leny = maxy - miny;
        var lenz = maxz - minz;

        var centerx = minx + (lenx / 2);
        var centery = miny + (leny / 2);
        var centerz = minz + (lenz / 2);

        var maxlen = Math.max(lenx, leny, lenz);
        var dist   = 2 * maxlen;

        // center camera on gcode objects center pos, but twice the maxlen
        this.viewControls.object.position.x = centerx;
        this.viewControls.object.position.y = centery;
        this.viewControls.object.position.z = centerz + dist;

        this.viewControls.target.x = centerx;
        this.viewControls.target.y = centery;
        this.viewControls.target.z = centerz;

        var fov = 2.2 * Math.atan(maxlen / (2 * dist)) * (180 / Math.PI);

        if (isNaN(fov)) {
            return console.warn("giving up on viewing extents because fov could not be calculated");
        }

        this.viewControls.object.fov = fov;

        var L = dist;
        var vector = this.viewControls.target.clone();
        var l = (new THREE.Vector3()).subVectors(this.camera.position, vector).length();
        var up = this.camera.up.clone();
        var quaternion = new THREE.Quaternion();

        // Zoom correction
        this.camera.translateZ(L - l);
        up.y = 1;
        up.x = 0;
        up.z = 0;
        quaternion.setFromAxisAngle(up, 0);
        up.y = 0;
        up.x = 1;
        up.z = 0;
        quaternion.setFromAxisAngle(up, 0);
        this.camera.position.applyQuaternion(quaternion);
        up.y = 0;
        up.x = 0;
        up.z = 1;
        quaternion.setFromAxisAngle(up, 0);

        this.camera.lookAt(vector);

        this.viewControls.object.updateProjectionMatrix();
    };

    // -------------------------------------------------------------------------

    // End viewer scope
})();

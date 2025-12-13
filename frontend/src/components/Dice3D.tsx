import React, { useEffect, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import * as CANNON from 'cannon';
// @ts-ignore
import { DiceManager, DiceD20 } from '../lib/dice';

interface DiceWithPhysicsProps {
  isRolling?: boolean;
  finalValue?: number;
}

const DiceWithPhysics: React.FC<DiceWithPhysicsProps> = ({ isRolling = false, finalValue }) => {
  const { scene } = useThree();
  const worldRef = useRef<CANNON.World | null>(null);
  const diceRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const floorBodyRef = useRef<CANNON.Body | null>(null);
  const floorMeshRef = useRef<THREE.Mesh | null>(null);
  const isRollingRef = useRef(false);
  const lastFinalValueRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Создаем физический мир Cannon.js с гравитацией для броска
    const world = new CANNON.World();
    world.gravity.set(0, -9.82 * 20, 0); // Гравитация для физической симуляции
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 16;
    worldRef.current = world;

    // Инициализируем менеджер кубиков ПЕРЕД созданием кубика
    DiceManager.setWorld(world);
    
    // Увеличиваем restitution для большего отскока через ContactMaterial
    // Находим ContactMaterial для пола и кубика и увеличиваем restitution
    if (world.contactMaterials && world.contactMaterials.length > 0) {
      const floorContactMaterial = world.contactMaterials.find(
        (cm: any) => cm.materials && 
        cm.materials.includes(DiceManager.floorBodyMaterial) &&
        cm.materials.includes(DiceManager.diceBodyMaterial)
      );
      if (floorContactMaterial) {
        floorContactMaterial.restitution = 0.7; // Увеличено с 0.5 до 0.7 для большего отскока
      }
    }

    // Создаем пол для физики
    const floorBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: DiceManager.floorBodyMaterial
    });
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    floorBody.position.set(0, -12, 0);
    world.add(floorBody);
    floorBodyRef.current = floorBody;

    // Создаем визуальный объект для пола (светло-зелёный)
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x90EE90, // Светло-зелёный цвет
      side: THREE.DoubleSide
    });
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -12, 0);
    scene.add(floorMesh);
    floorMeshRef.current = floorMesh;

    // Стены убраны для проверки видимости кубика

    // Создаем d20 кубик увеличенного размера
    // create() вызывается в конструкторе, но только после setWorld()
    const dice = new DiceD20({ size: 4.8 }); // Увеличен размер кубика в 1.5 раза (3.2 * 1.5)
    diceRef.current = dice;
    
    // Получаем объект кубика
    const diceObject = dice.getObject();
    
    // Проверяем, что объект создан
    if (!diceObject) {
      console.error('Dice object is null!');
      return;
    }
    
    // Добавляем кубик на сцену
    scene.add(diceObject);
    
    // Начальная позиция кубика (в центре видимой области)
    // Камера смотрит на (0, 0, 0), пол на y=-6, поэтому кубик должен быть выше пола
    // Устанавливаем позицию в центре видимой области камеры
    diceObject.position.set(0, 2, 0); // Позиция в центре видимой области
    diceObject.visible = true; // Убеждаемся, что кубик видим
    
    // Обновляем физическое тело кубика
    dice.updateBodyFromMesh();
    
    // Отладочная информация
    console.log('Dice created:', {
      position: diceObject.position,
      visible: diceObject.visible,
      scale: diceObject.scale,
      size: 4.8,
      geometry: diceObject.geometry ? 'exists' : 'null',
      material: diceObject.material ? 'exists' : 'null',
      children: diceObject.children.length
    });
    
    // Отладочная информация
    console.log('Dice created:', {
      position: diceObject.position,
      visible: diceObject.visible,
      scale: diceObject.scale,
      size: 4.8
    });

    return () => {
      // Очистка при размонтировании
      if (diceRef.current) {
        scene.remove(diceRef.current.getObject());
      }
      // Стены убраны
      if (floorMeshRef.current) {
        scene.remove(floorMeshRef.current);
        floorMeshRef.current.geometry.dispose();
        (floorMeshRef.current.material as THREE.Material).dispose();
        floorMeshRef.current = null;
      }
      if (floorBodyRef.current && worldRef.current) {
        worldRef.current.remove(floorBodyRef.current);
      }
      if (worldRef.current) {
        worldRef.current = null;
      }
      initializedRef.current = false;
    };
  }, [scene]);

  // Запускаем бросок с определённым значением
  useEffect(() => {
    // Проверяем, что бросок должен начаться и значение определено
    if (!isRolling || !diceRef.current || !worldRef.current || finalValue === undefined) {
      // Если броска нет, сбрасываем флаг только если кубик не в процессе симуляции
      if (!isRolling && diceRef.current && !diceRef.current.simulationRunning && !DiceManager.throwRunning) {
        isRollingRef.current = false;
      }
      return;
    }
    
    // КРИТИЧЕСКИ ВАЖНО: Проверяем, что это новый бросок (значение изменилось)
    // Это основная защита от повторных запусков
    if (lastFinalValueRef.current === finalValue) {
      return; // Уже запущен бросок с этим значением
    }
    
    // Проверяем, что библиотека не занята другим броском
    if (DiceManager.throwRunning) {
      return; // Библиотека еще обрабатывает предыдущий бросок
    }
    
    // Проверяем, что кубик не находится в процессе симуляции
    if (diceRef.current.simulationRunning) {
      return; // Кубик еще в процессе предыдущего броска
    }
    
    // Запоминаем значение СРАЗУ, ДО всех операций
    // Это предотвратит повторный запуск, даже если useEffect сработает снова
    lastFinalValueRef.current = finalValue;
    isRollingRef.current = true;
    const dice = diceRef.current;

    // Сбрасываем тело кубика
    dice.resetBody();
    
    // Устанавливаем начальную позицию и вращение (в центре видимой области)
    const diceObject = dice.getObject();
    diceObject.position.set(0, 2, 0); // Позиция в центре видимой области камеры
    diceObject.visible = true; // Убеждаемся, что кубик видим
    diceObject.quaternion.x = (Math.random() * 90 - 45) * Math.PI / 180;
    dice.getObject().quaternion.z = (Math.random() * 90 - 45) * Math.PI / 180;
    dice.updateBodyFromMesh();
    
    // Придаём случайную скорость и угловую скорость для эффекта броска
    // Увеличены значения для большего вращения и отскока
    const rand = Math.random() * 2; // Увеличена случайная компонента
    const yRand = Math.random() * 6; // Увеличена вертикальная случайная компонента
    if (dice.getObject().body) {
      dice.getObject().body.velocity.set(
        3 + rand,       // Увеличена горизонтальная скорость для большего отскока
        10 + yRand,     // Увеличена вертикальная скорость для большего отскока
        2 + rand        // Увеличена глубина
      );
      dice.getObject().body.angularVelocity.set(
        (15 * Math.random() - 7.5),  // Увеличена угловая скорость для большего вращения
        (15 * Math.random() - 7.5),
        (15 * Math.random() - 7.5)
      );
    }

    // Запускаем бросок с определённым значением
    // Библиотека сама проверяет throwRunning и выбросит ошибку, если уже идет бросок
    try {
      DiceManager.prepareValues([{
        dice: dice,
        value: finalValue
      }]);
    } catch (error) {
      // Если библиотека занята, просто игнорируем ошибку и сбрасываем флаг
      console.warn('DiceManager is busy:', error);
      isRollingRef.current = false;
      lastFinalValueRef.current = undefined;
      return;
    }

    // Отслеживаем завершение броска (библиотека сама управляет позицией)
    const checkFinished = () => {
      if (!dice.simulationRunning && DiceManager.throwRunning === false) {
        // Библиотека уже вернула кубик в нужную позицию через shiftUpperValue и setVectors
        isRollingRef.current = false;
      }
    };

    const interval = setInterval(checkFinished, 100);
    
    return () => {
      clearInterval(interval);
    };
  }, [isRolling, finalValue]);

  // Обновляем физику через useFrame
  useFrame(() => {
    if (worldRef.current && diceRef.current) {
      worldRef.current.step(1 / 60);
      diceRef.current.updateMeshFromBody();
    }
  });

  return null;
};

interface Dice3DProps {
  isRolling?: boolean;
  finalValue?: number;
}

const CameraController: React.FC = () => {
  const { camera } = useThree();
  
  useEffect(() => {
    // Настраиваем камеру для вида сверху
    camera.position.set(0, 20, 0);
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 0, -1); // Меняем направление "вверх" для правильного вида сверху
  }, [camera]);
  
  return null;
};

const Dice3D: React.FC<Dice3DProps> = ({ isRolling = false, finalValue }) => {
  return (
    <div style={{ width: 320, height: 320, position: 'relative' }}>
      <Canvas 
        camera={{ position: [0, 20, 0], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
      >
        <CameraController />
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} />
        <DiceWithPhysics isRolling={isRolling} finalValue={finalValue} />
      </Canvas>
    </div>
  );
};

export default Dice3D;

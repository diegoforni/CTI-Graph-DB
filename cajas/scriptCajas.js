document.addEventListener('DOMContentLoaded', function() {
    // Elementos del DOM
    const container = document.getElementById('diagram-container');
    const addButton = document.getElementById('add-box');
    
    // Contador para llevar registro de cuántas cajas hemos añadido
    let boxCount = 0;
    let lastBox = null;
    
    // Añadir la primera caja por defecto
    addBox();
    
    // Función para añadir una nueva caja
    addButton.addEventListener('click', addBox);
    
    function addBox() {
        boxCount++;
        
        // Decidir qué tipo de caja añadir
        let boxClass = 'box3'; // Por defecto, añadir cajas del tipo 3
        let boxText = 'Caja 3';
        
        if (boxCount === 1) {
            boxClass = 'box1';
            boxText = 'Caja 1';
        } else if (boxCount === 2) {
            boxClass = 'box2';
            boxText = 'Caja 2';
        }
        
        // Crear el elemento de la nueva caja
        const newBox = document.createElement('div');
        newBox.className = `box ${boxClass}`;
        newBox.textContent = boxText;
        newBox.id = `box-${boxCount}`;
        
        // Posicionar la caja en función del número de cajas
        if (boxCount === 1) {
            // Primera caja en el lado izquierdo
            newBox.style.position = 'absolute';
            newBox.style.left = '20px';
            newBox.style.top = 'calc(50% - 50px)'; // Centrada verticalmente
        } else {
            // Calcular posición para las siguientes cajas
            const prevBox = document.getElementById(`box-${boxCount-1}`);
            const prevRect = prevBox.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // Posicionar la nueva caja a la derecha de la anterior
            newBox.style.position = 'absolute';
            newBox.style.left = (prevRect.right - containerRect.left + 80) + 'px';
            newBox.style.top = 'calc(50% - 50px)'; // Centrada verticalmente
            
            // Crear una flecha conectando las cajas
            createArrow(prevBox, newBox);
        }
        
        // Añadir la nueva caja al contenedor
        container.appendChild(newBox);
        lastBox = newBox;
        
        // Ajustar el ancho del contenedor si es necesario
        const boxRect = newBox.getBoundingClientRect();
        const minWidth = boxRect.right - container.getBoundingClientRect().left + 50;
        if (container.clientWidth < minWidth) {
            container.style.width = minWidth + 'px';
        }
    }
    
    function createArrow(fromBox, toBox) {
        const fromRect = fromBox.getBoundingClientRect();
        const toRect = toBox.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        // Calcular punto de inicio y fin de la flecha horizontal
        const fromX = fromRect.right - containerRect.left;
        const fromY = fromRect.top + fromRect.height/2 - containerRect.top;
        const toX = toRect.left - containerRect.left;
        const toY = toRect.top + toRect.height/2 - containerRect.top;
        
        // Crear línea de la flecha (horizontal)
        const arrowLine = document.createElement('div');
        arrowLine.className = 'arrow-line';
        arrowLine.style.position = 'absolute';
        arrowLine.style.height = '4px';
        arrowLine.style.width = (toX - fromX) + 'px';
        arrowLine.style.left = fromX + 'px';
        arrowLine.style.top = (fromY - 2) + 'px'; // Centrado vertical
        container.appendChild(arrowLine);
        
        // Crear punta de la flecha (ahora apunta a la derecha)
        const arrowHead = document.createElement('div');
        arrowHead.className = 'arrow-head';
        arrowHead.style.position = 'absolute';
        arrowHead.style.left = (toX - 12) + 'px';
        arrowHead.style.top = (toY - 12) + 'px';
        arrowHead.style.borderWidth = '12px 0 12px 12px'; // Flecha apuntando a la derecha
        arrowHead.style.borderColor = "black";
        container.appendChild(arrowHead);
    }
});